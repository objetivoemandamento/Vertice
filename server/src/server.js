require('./vertice-preload');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const { v4: uuid } = require('uuid');
const crypto = require('crypto');

const app = express();
app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '8mb', strict: true }));

const db = new Database(process.env.DB_PATH || 'vertice.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS customers(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS subscriptions(id TEXT PRIMARY KEY,customer_id TEXT NOT NULL,plan TEXT NOT NULL,status TEXT NOT NULL,current_period_end TEXT,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,customer_id TEXT NOT NULL,device_name TEXT,mode TEXT,last_seen_at TEXT,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS commands(id TEXT PRIMARY KEY,customer_id TEXT NOT NULL,device_id TEXT,mode TEXT,command TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS monthly_sales(id TEXT PRIMARY KEY,customer_id TEXT,period_month TEXT NOT NULL,gross_revenue REAL DEFAULT 0,net_revenue REAL DEFAULT 0,sales_count INTEGER DEFAULT 0,active_subscriptions INTEGER DEFAULT 0,cancellations INTEGER DEFAULT 0,delinquent INTEGER DEFAULT 0,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sales(id TEXT PRIMARY KEY,customer_id TEXT NOT NULL,amount REAL NOT NULL,product TEXT,channel TEXT,status TEXT NOT NULL DEFAULT 'pending',mp_order_id TEXT,mp_payment_id TEXT,checkout_url TEXT,paid_at TEXT,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS payment_orders(id TEXT PRIMARY KEY,sale_id TEXT NOT NULL,customer_id TEXT NOT NULL,provider TEXT NOT NULL,provider_order_id TEXT,provider_payment_id TEXT,status TEXT NOT NULL,amount REAL NOT NULL,checkout_url TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
`);

const salesColumns = db.prepare('PRAGMA table_info(sales)').all().map(c => c.name);
if (!salesColumns.includes('external_reference')) db.exec('ALTER TABLE sales ADD COLUMN external_reference TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_external_reference ON sales(external_reference) WHERE external_reference IS NOT NULL');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_mp_order_id ON sales(mp_order_id) WHERE mp_order_id IS NOT NULL');
db.exec('CREATE INDEX IF NOT EXISTS idx_sales_customer_created ON sales(customer_id, created_at)');
db.exec('CREATE INDEX IF NOT EXISTS idx_commands_customer_created ON commands(customer_id, created_at)');
db.exec('CREATE INDEX IF NOT EXISTS idx_devices_customer ON devices(customer_id)');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET && process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET é obrigatório em produção.');
const secret = JWT_SECRET || crypto.randomBytes(32).toString('hex');
const OWNER_LOGIN = process.env.OWNER_LOGIN || 'admchefe';
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || 'coringa';
const PORT = Number(process.env.PORT || 8080);
const RATE_WINDOW_MS = 60_000;
const RATE_LIMITS = new Map();

function tokenFor(c, role = 'CUSTOMER') { return jwt.sign({ sub: c.id, email: c.email, role }, secret, { expiresIn: '30d' }); }
function auth(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    if (!h.startsWith('Bearer ')) return res.status(401).json({ error: 'Não autenticado' });
    req.user = jwt.verify(h.slice(7), secret);
    next();
  } catch { return res.status(401).json({ error: 'Sessão inválida' }); }
}
function ownerOnly(req, res, next) { if (req.user.role !== 'OWNER') return res.status(403).json({ error: 'Acesso de proprietário necessário.' }); next(); }
function subscription(customerId) { return db.prepare('SELECT * FROM subscriptions WHERE customer_id=? ORDER BY updated_at DESC LIMIT 1').get(customerId) || null; }
function effectiveStatus(s) { if (!s) return 'blocked'; if (s.status === 'active' && s.current_period_end && new Date(s.current_period_end) < new Date()) return 'pending'; return s.status; }
function mpConfigured() { return Boolean(process.env.MERCADOPAGO_ACCESS_TOKEN); }
function money(v) { const n = Number(v); return Number.isFinite(n) ? Number(n.toFixed(2)) : NaN; }
function cleanMonth(value) { const month = String(value || new Date().toISOString().slice(0, 7)); return /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : null; }
function rateLimit(req, res, key, max) {
  const now = Date.now(); const current = RATE_LIMITS.get(key);
  if (!current || now - current.startedAt >= RATE_WINDOW_MS) { RATE_LIMITS.set(key, { startedAt: now, count: 1 }); return true; }
  current.count += 1;
  if (current.count > max) { res.status(429).json({ error: 'Muitas tentativas. Aguarde um momento.' }); return false; }
  return true;
}
function parseSignature(header) {
  const out = {};
  String(header || '').split(',').forEach(part => { const [k, ...rest] = part.split('='); if (k && rest.length) out[k.trim()] = rest.join('=').trim(); });
  return out;
}
function validMpWebhook(req) {
  const hookSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (!hookSecret) return false;
  const sig = parseSignature(req.headers['x-signature']);
  const requestId = String(req.headers['x-request-id'] || '');
  const dataId = String(req.query['data.id'] || req.body?.data?.id || '');
  const ts = String(sig.ts || '');
  const v1 = String(sig.v1 || '');
  if (!dataId || !requestId || !ts || !v1) return false;
  const tsMs = Number(ts) * 1000;
  if (!Number.isFinite(tsMs) || Math.abs(Date.now() - tsMs) > 10 * 60_000) return false;
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const expected = crypto.createHmac('sha256', hookSecret).update(manifest).digest('hex');
  const a = Buffer.from(expected, 'utf8'); const b = Buffer.from(v1, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function encodeCustomer(customerId) { return customerId === 'owner' ? 'owner' : String(customerId).replace(/-/g, '').toLowerCase(); }
function makeExternalReference(customerId, saleId) { return `VTX-${encodeCustomer(customerId)}-${String(saleId).replace(/-/g, '').toLowerCase()}`; }
function parseExternalReference(ref) {
  const value = String(ref || '');
  const legacy = value.match(/^VTX-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  if (legacy) return { customerId: 'owner', saleId: legacy[1].toLowerCase() };
  const modern = value.match(/^VTX-(owner|[0-9a-f]{32})-([0-9a-f]{32})$/i);
  if (!modern) return null;
  const customerToken = modern[1].toLowerCase();
  const customerId = customerToken === 'owner' ? 'owner' : `${customerToken.slice(0,8)}-${customerToken.slice(8,12)}-${customerToken.slice(12,16)}-${customerToken.slice(16,20)}-${customerToken.slice(20)}`;
  const s = modern[2].toLowerCase();
  return { customerId, saleId: `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}` };
}
function paymentFromOrder(order, requiredAmount) {
  const required = money(requiredAmount); const paidTotal = money(order?.total_paid_amount || 0);
  const payments = Array.isArray(order?.transactions?.payments) ? order.transactions.payments : [];
  const approvedEnough = payments.some(p => ['approved', 'processed', 'accredited'].includes(String(p?.status || '').toLowerCase()) && money(p?.paid_amount ?? p?.amount ?? 0) >= required);
  return (String(order?.status || '').toLowerCase() === 'processed' && paidTotal >= required) || approvedEnough;
}
function statusForOrder(order, amount) {
  const status = String(order?.status || '').toLowerCase();
  if (paymentFromOrder(order, amount)) return 'paid';
  if (['cancelled', 'canceled'].includes(status)) return 'cancelled';
  if (status === 'expired') return 'expired';
  return 'pending';
}
function firstPaymentId(order) { const p = Array.isArray(order?.transactions?.payments) ? order.transactions.payments[0] : null; return p?.id ? String(p.id) : null; }
function orderProduct(order) { return String(order?.items?.[0]?.title || order?.items?.[0]?.description || 'Venda VÉRTICE').slice(0, 120); }
function upsertPaymentOrder(sale, status, paymentId, now) {
  const existing = db.prepare('SELECT id FROM payment_orders WHERE sale_id=?').get(sale.id);
  if (existing) db.prepare('UPDATE payment_orders SET provider_order_id=?,provider_payment_id=?,status=?,amount=?,checkout_url=?,updated_at=? WHERE sale_id=?').run(sale.mp_order_id, paymentId, status, sale.amount, sale.checkout_url || '', now, sale.id);
  else db.prepare('INSERT INTO payment_orders(id,sale_id,customer_id,provider,provider_order_id,provider_payment_id,status,amount,checkout_url,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(uuid(), sale.id, sale.customer_id, 'mercado_pago', sale.mp_order_id, paymentId, status, sale.amount, sale.checkout_url || '', now, now);
}
function createOrRecoverSaleFromOrder(order, fallbackCustomerId = null, fallbackSaleId = null) {
  const providerOrderId = String(order?.id || ''); if (!providerOrderId) return null;
  let sale = db.prepare('SELECT * FROM sales WHERE mp_order_id=?').get(providerOrderId); if (sale) return sale;
  const parsed = parseExternalReference(order?.external_reference); const customerId = parsed?.customerId || fallbackCustomerId; const saleId = parsed?.saleId || fallbackSaleId;
  if (!customerId || !saleId) return null;
  const amount = money(order.total_amount); if (!Number.isFinite(amount) || amount <= 0) return null;
  const existingById = db.prepare('SELECT * FROM sales WHERE id=?').get(saleId);
  if (existingById && existingById.customer_id !== customerId) return null;
  const createdAt = String(order.date_created || new Date().toISOString()); const status = statusForOrder(order, amount); const paidAt = status === 'paid' ? new Date().toISOString() : null;
  const product = orderProduct(order); const externalReference = String(order.external_reference || makeExternalReference(customerId, saleId)); const paymentId = firstPaymentId(order); const checkoutUrl = String(order.checkout_url || existingById?.checkout_url || '');
  if (existingById) db.prepare('UPDATE sales SET amount=?,product=?,channel=?,status=?,mp_order_id=?,mp_payment_id=?,checkout_url=?,paid_at=COALESCE(?,paid_at),external_reference=? WHERE id=? AND customer_id=?').run(amount, product, 'mercado_pago', status, providerOrderId, paymentId, checkoutUrl, paidAt, externalReference, saleId, customerId);
  else db.prepare('INSERT INTO sales(id,customer_id,amount,product,channel,status,mp_order_id,mp_payment_id,checkout_url,paid_at,created_at,external_reference) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(saleId, customerId, amount, product, 'mercado_pago', status, providerOrderId, paymentId, checkoutUrl, paidAt, createdAt, externalReference);
  sale = db.prepare('SELECT * FROM sales WHERE id=? AND customer_id=?').get(saleId, customerId);
  if (!sale) return null;
  upsertPaymentOrder(sale, status, paymentId, new Date().toISOString());
  return sale;
}
async function reconcileMpOrder(providerOrderId, fallbackCustomerId = null, fallbackSaleId = null) {
  const order = await mpRequest(`/v1/orders/${encodeURIComponent(providerOrderId)}`, { method: 'GET' });
  let sale = db.prepare('SELECT * FROM sales WHERE mp_order_id=?').get(providerOrderId);
  if (!sale) sale = createOrRecoverSaleFromOrder(order, fallbackCustomerId, fallbackSaleId);
  if (!sale) return { order, matched: false };
  const localStatus = statusForOrder(order, sale.amount); const now = new Date().toISOString(); const paymentId = firstPaymentId(order);
  db.prepare("UPDATE sales SET status=?,mp_payment_id=COALESCE(?,mp_payment_id),paid_at=CASE WHEN ?='paid' THEN COALESCE(paid_at,?) ELSE paid_at END WHERE id=?").run(localStatus, paymentId, localStatus, now, sale.id);
  sale = db.prepare('SELECT * FROM sales WHERE id=?').get(sale.id);
  upsertPaymentOrder(sale, localStatus, paymentId, now);
  return { order, matched: true, status: localStatus, saleId: sale.id };
}
async function recoverRecentOrders(customerId, month) {
  if (!mpConfigured()) return 0;
  const start = `${month}-01T00:00:00.000Z`; const endDate = new Date(start); endDate.setUTCMonth(endDate.getUTCMonth() + 1);
  const data = await mpRequest(`/v1/orders?begin_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(endDate.toISOString())}&type=online&limit=100`, { method: 'GET' });
  const orders = Array.isArray(data?.data) ? data.data : []; let recovered = 0;
  for (const order of orders) {
    const parsed = parseExternalReference(order?.external_reference); if (!parsed || parsed.customerId !== customerId) continue;
    const existing = db.prepare('SELECT id FROM sales WHERE mp_order_id=? OR id=?').get(String(order.id || ''), parsed.saleId);
    if (!existing) recovered += 1;
    createOrRecoverSaleFromOrder(order, parsed.customerId, parsed.saleId);
  }
  return recovered;
}

async function mpRequest(path, options = {}) {
  if (!mpConfigured()) throw new Error('Mercado Pago não configurado no servidor.');
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`https://api.mercadopago.com${path}`, { ...options, signal: controller.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}`, ...(options.headers || {}) } });
    const text = await response.text(); let data = {}; try { data = text ? JSON.parse(text) : {}; } catch {}
    if (!response.ok) { const detail = data?.message || data?.error || `HTTP ${response.status}`; const err = new Error(`Mercado Pago: ${detail}`); err.status = response.status; err.provider = data; throw err; }
    return data;
  } finally { clearTimeout(timer); }
}

app.get('/health', (req, res) => res.json({ ok: true, service: 'vertice', version: '1.4.0' }));
app.post('/auth/register', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase(); const password = String(req.body.password || '');
  if (!email || email.length > 254 || password.length < 8 || password.length > 128) return res.status(400).json({ error: 'Informe e-mail válido e senha entre 8 e 128 caracteres.' });
  try { const id = uuid(); const hash = await bcrypt.hash(password, 12); const now = new Date().toISOString(); db.prepare('INSERT INTO customers VALUES(?,?,?,?)').run(id, email, hash, now); db.prepare('INSERT INTO subscriptions VALUES(?,?,?,?,?,?)').run(uuid(), id, 'basic', 'pending', null, now); return res.status(201).json({ token: tokenFor({ id, email }), role: 'CUSTOMER', customer: { id, email } }); }
  catch { return res.status(409).json({ error: 'Conta já existente ou dados inválidos.' }); }
});
app.post('/auth/login', async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown'; if (!rateLimit(req, res, `login:${ip}`, 10)) return;
  const login = String(req.body.login || req.body.email || '').trim().toLowerCase(); const password = String(req.body.password || '');
  if (login === OWNER_LOGIN.toLowerCase() && password === OWNER_PASSWORD) return res.json({ token: tokenFor({ id: 'owner', email: OWNER_LOGIN }, 'OWNER'), role: 'OWNER', customer: { id: 'owner', email: OWNER_LOGIN } });
  const c = db.prepare('SELECT * FROM customers WHERE email=?').get(login);
  if (!c || !(await bcrypt.compare(password, c.password_hash))) return res.status(401).json({ error: 'Login ou senha inválidos.' });
  return res.json({ token: tokenFor(c, 'CUSTOMER'), role: 'CUSTOMER', customer: { id: c.id, email: c.email } });
});
app.get('/me', auth, (req, res) => {
  if (req.user.role === 'OWNER') return res.json({ role: 'OWNER', customer: { id: 'owner', email: req.user.email }, subscription: { plan: 'owner', status: 'active', currentPeriodEnd: null } });
  const s = subscription(req.user.sub); res.json({ role: 'CUSTOMER', customer: { id: req.user.sub, email: req.user.email }, subscription: s ? { plan: s.plan, status: effectiveStatus(s), currentPeriodEnd: s.current_period_end } : null });
});
app.post('/devices/register', auth, (req, res) => {
  if (req.user.role !== 'CUSTOMER') return res.status(403).json({ error: 'Dispositivo comercial necessário.' });
  const deviceId = String(req.body.deviceId || '').trim(); const mode = String(req.body.mode || '').trim(); const name = String(req.body.deviceName || '').trim().slice(0, 100);
  if (!deviceId || deviceId.length > 100 || !['comando','operacao','monitoramento'].includes(mode)) return res.status(400).json({ error: 'deviceId, mode e deviceName inválidos.' });
  const now = new Date().toISOString(); const old = db.prepare('SELECT id,customer_id FROM devices WHERE id=?').get(deviceId);
  if (old && old.customer_id !== req.user.sub) return res.status(403).json({ error: 'Dispositivo pertence a outra conta.' });
  if (old) db.prepare('UPDATE devices SET mode=?,device_name=?,last_seen_at=? WHERE id=?').run(mode, name, now, deviceId); else db.prepare('INSERT INTO devices VALUES(?,?,?,?,?,?)').run(deviceId, req.user.sub, name, mode, now, now);
  res.json({ ok: true, deviceId });
});
app.post('/commands', auth, (req, res) => {
  if (req.user.role !== 'CUSTOMER') return res.status(403).json({ error: 'Use o painel do proprietário para administração.' });
  const s = subscription(req.user.sub); if (effectiveStatus(s) !== 'active') return res.status(402).json({ error: 'Assinatura não está ativa.' });
  const command = String(req.body.command || '').trim(); const mode = String(req.body.mode || '').trim(); const deviceId = String(req.body.deviceId || '').trim();
  const scope = String(req.body.scope || 'somente_o_solicitado'); const preserveUnrequested = req.body.preservar_demais_configuracoes !== false; const imageBase64 = typeof req.body.imageBase64 === 'string' ? req.body.imageBase64 : null;
  if (!command || command.length > 2000) return res.status(400).json({ error: 'Comando inválido.' });
  if (mode && !['comando','operacao','monitoramento'].includes(mode)) return res.status(400).json({ error: 'Modo inválido.' });
  if (imageBase64 && imageBase64.length > 7_000_000) return res.status(400).json({ error: 'Imagem muito grande.' });
  if (deviceId) { const d = db.prepare('SELECT customer_id FROM devices WHERE id=?').get(deviceId); if (!d || d.customer_id !== req.user.sub) return res.status(403).json({ error: 'Dispositivo não pertence à conta.' }); }
  const id = uuid(), now = new Date().toISOString(); db.prepare('INSERT INTO commands VALUES(?,?,?,?,?,?,?)').run(id, req.user.sub, deviceId || null, mode || null, command, 'queued', now);
  res.status(202).json({ id, status: 'queued', message: imageBase64 ? 'Comando e imagem recebidos pelo Vértice.' : 'Comando recebido pelo Vértice.', executionPolicy: { scope, preserveUnrequested, hasImage: Boolean(imageBase64) } });
});
app.get('/commands', auth, (req, res) => {
  if (req.user.role !== 'CUSTOMER') return res.json({ commands: [] });
  const rows = db.prepare('SELECT id,device_id AS deviceId,mode,command,status,created_at AS createdAt FROM commands WHERE customer_id=? ORDER BY created_at DESC LIMIT 50').all(req.user.sub); res.json({ commands: rows });
});
app.post('/sales/orders', auth, async (req, res) => {
  if (req.user.role !== 'CUSTOMER' && req.user.role !== 'OWNER') return res.status(403).json({ error: 'Painel comercial necessário.' });
  const product = String(req.body.product || '').trim().slice(0, 120); const amount = money(req.body.amount);
  if (!product || !Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) return res.status(400).json({ error: 'Informe produto e valor válido.' });
  if (!mpConfigured()) return res.status(503).json({ error: 'Mercado Pago ainda não foi configurado no servidor.' });
  const customerId = req.user.role === 'OWNER' ? 'owner' : req.user.sub; const saleId = uuid(); const externalReference = makeExternalReference(customerId, saleId); const now = new Date().toISOString();
  try {
    db.prepare('INSERT INTO sales(id,customer_id,amount,product,channel,status,created_at,external_reference) VALUES(?,?,?,?,?,?,?,?)').run(saleId, customerId, amount, product, 'mercado_pago', 'pending', now, externalReference);
    const order = await mpRequest('/v1/orders', { method: 'POST', headers: { 'X-Idempotency-Key': saleId }, body: JSON.stringify({ type: 'online', total_amount: amount.toFixed(2), external_reference: externalReference, processing_mode: 'manual', items: [{ title: product, quantity: 1, unit_price: amount.toFixed(2) }] }) });
    const checkoutUrl = String(order.checkout_url || ''); const orderId = String(order.id || ''); if (!checkoutUrl || !orderId) throw new Error('Mercado Pago não retornou os dados necessários da order.');
    db.prepare('UPDATE sales SET mp_order_id=?,checkout_url=? WHERE id=? AND customer_id=?').run(orderId, checkoutUrl, saleId, customerId);
    const sale = db.prepare('SELECT * FROM sales WHERE id=?').get(saleId); upsertPaymentOrder(sale, 'pending', null, new Date().toISOString());
    res.status(201).json({ saleId, orderId, status: 'pending', checkoutUrl });
  } catch (e) {
    try { db.prepare(\"UPDATE sales SET status='failed' WHERE id=? AND status='pending'\").run(saleId); } catch {}
    console.error('MP create order error', JSON.stringify(e.provider || { message: e.message, status: e.status }, null, 2));
    res.status(e.status && e.status < 500 ? e.status : 502).json({ error: e.message || 'Não foi possível criar a cobrança.', details: e.provider?.details || undefined });
  }
});
app.get('/sales', auth, async (req, res) => {
  if (req.user.role !== 'CUSTOMER' && req.user.role !== 'OWNER') return res.status(403).json({ error: 'Painel comercial necessário.' });
  const month = cleanMonth(req.query.month); if (!month) return res.status(400).json({ error: 'Mês inválido. Use YYYY-MM.' });
  const customerId = req.user.role === 'OWNER' ? 'owner' : req.user.sub;
  try {
    const rows0 = db.prepare('SELECT id,amount,product,channel,status,mp_order_id AS mpOrderId,checkout_url AS checkoutUrl,paid_at AS paidAt,created_at AS createdAt FROM sales WHERE customer_id=? AND substr(created_at,1,7)=? ORDER BY created_at DESC LIMIT 100').all(customerId, month);
    for (const row of rows0) if (row.status === 'pending' && row.mpOrderId) { try { await reconcileMpOrder(row.mpOrderId, customerId, row.id); } catch (e) { console.error('MP auto-sync error', e.message); } }
    try { await recoverRecentOrders(customerId, month); } catch (e) { console.error('MP recovery search error', e.message); }
    const rows = db.prepare('SELECT id,amount,product,channel,status,mp_order_id AS mpOrderId,checkout_url AS checkoutUrl,paid_at AS paidAt,created_at AS createdAt FROM sales WHERE customer_id=? AND substr(created_at,1,7)=? ORDER BY created_at DESC LIMIT 100').all(customerId, month);
    const totals = db.prepare(\"SELECT COALESCE(SUM(CASE WHEN status='paid' THEN amount ELSE 0 END),0) gross,COUNT(CASE WHEN status='paid' THEN 1 END) paidCount,COUNT(*) totalCount FROM sales WHERE customer_id=? AND substr(created_at,1,7)=?\").get(customerId, month);
    res.json({ month, sales: rows, summary: { grossRevenue: Number(totals.gross || 0), paidCount: Number(totals.paidCount || 0), totalCount: Number(totals.totalCount || 0) } });
  } catch (e) { console.error('Sales read error', e); res.status(500).json({ error: 'Não foi possível carregar as vendas.' }); }
});
app.post('/sales/orders/:saleId/sync', auth, async (req, res) => {
  if (req.user.role !== 'CUSTOMER' && req.user.role !== 'OWNER') return res.status(403).json({ error: 'Painel comercial necessário.' });
  const customerId = req.user.role === 'OWNER' ? 'owner' : req.user.sub; const sale = db.prepare('SELECT * FROM sales WHERE id=? AND customer_id=?').get(req.params.saleId, customerId);
  if (!sale) return res.status(404).json({ error: 'Venda não encontrada.' }); if (!sale.mp_order_id) return res.status(400).json({ error: 'Venda sem pedido Mercado Pago.' });
  try { const result = await reconcileMpOrder(sale.mp_order_id, customerId, sale.id); res.json({ saleId: sale.id, status: result.status || sale.status, orderId: sale.mp_order_id }); }
  catch (e) { console.error('MP sync error', JSON.stringify(e.provider || { message: e.message, status: e.status }, null, 2)); res.status(502).json({ error: e.message || 'Não foi possível sincronizar a venda.' }); }
});
app.post('/webhooks/mercadopago', async (req, res) => {
  if (!validMpWebhook(req)) return res.status(401).json({ error: 'Webhook Mercado Pago não autorizado.' });
  res.sendStatus(200); const type = String(req.query.type || req.body?.type || ''); const orderId = String(req.query['data.id'] || req.body?.data?.id || '');
  if (type && type !== 'order') return; if (!orderId) return; try { await reconcileMpOrder(orderId); } catch (e) { console.error('MP webhook processing error', e.message); }
});
app.get('/reports/monthly', auth, (req, res) => {
  if (req.user.role !== 'CUSTOMER') return res.status(403).json({ error: 'Painel comercial necessário.' }); const month = cleanMonth(req.query.month); if (!month) return res.status(400).json({ error: 'Mês inválido. Use YYYY-MM.' });
  const sales = db.prepare('SELECT * FROM monthly_sales WHERE customer_id=? AND period_month=?').get(req.user.sub, month) || { period_month: month, gross_revenue: 0, net_revenue: 0, sales_count: 0, active_subscriptions: 0, cancellations: 0, delinquent: 0 };
  const agg = db.prepare(\"SELECT COALESCE(SUM(CASE WHEN status='paid' THEN amount ELSE 0 END),0) gross, COUNT(CASE WHEN status='paid' THEN 1 END) count FROM sales WHERE customer_id=? AND substr(created_at,1,7)=?\").get(req.user.sub, month);
  const gross = Number(agg.gross || sales.gross_revenue || 0); const count = Number(agg.count || sales.sales_count || 0);
  res.json({ report: { month: sales.period_month, grossRevenue: gross, netRevenue: Number(sales.net_revenue || gross), salesCount: count, activeSubscriptions: Number(sales.active_subscriptions || 0), cancellations: Number(sales.cancellations || 0), delinquent: Number(sales.delinquent || 0), ticketAverage: count ? gross / count : 0 } });
});
app.get('/ranking', auth, (req, res) => {
  if (req.user.role !== 'CUSTOMER') return res.status(403).json({ error: 'Painel comercial necessário.' }); const month = cleanMonth(req.query.month); if (!month) return res.status(400).json({ error: 'Mês inválido. Use YYYY-MM.' });
  const rows = db.prepare(`SELECT c.id,COALESCE(SUM(CASE WHEN s.status='paid' THEN s.amount ELSE 0 END),0) gross,COUNT(CASE WHEN s.status='paid' THEN 1 END) sales FROM customers c LEFT JOIN sales s ON s.customer_id=c.id AND substr(s.created_at,1,7)=? GROUP BY c.id ORDER BY gross DESC`).all(month);
  const currentIndex = rows.findIndex(r => r.id === req.user.sub); const current = rows[currentIndex] || { gross: 0, sales: 0 };
  res.json({ participation:'private_default', ranking:{ position: currentIndex >= 0 ? currentIndex + 1 : null, total: rows.length, score: Math.round(Number(current.gross) * 0.1 + Number(current.sales) * 2) }, benchmark:{ topScore: rows.length ? Math.round(Number(rows[0].gross) * 0.1 + Number(rows[0].sales) * 2) : 0 }, leaderboard: rows.slice(0,10).map((r,i)=>({position:i+1,score:Math.round(Number(r.gross)*0.1+Number(r.sales)*2)})) });
});
app.get('/admin/overview', auth, ownerOnly, (req, res) => {
  const customers = db.prepare('SELECT COUNT(*) n FROM customers').get().n; const active = db.prepare(\"SELECT COUNT(*) n FROM subscriptions WHERE status='active'\").get().n; const devices = db.prepare('SELECT COUNT(*) n FROM devices').get().n; const commandsToday = db.prepare(\"SELECT COUNT(*) n FROM commands WHERE created_at>=date('now')\").get().n; const salesMonth = db.prepare(\"SELECT COALESCE(SUM(CASE WHEN status='paid' THEN amount ELSE 0 END),0) n FROM sales WHERE substr(created_at,1,7)=substr(date('now'),1,7)\").get().n;
  res.json({ customers, activeSubscriptions: active, devices, commandsToday, salesMonth: Number(salesMonth || 0) });
});
app.get('/admin/customers', auth, ownerOnly, (req, res) => {
  const rows = db.prepare(`SELECT c.id,c.email,c.created_at createdAt,COALESCE(s.status,'blocked') subscriptionStatus,COALESCE(s.plan,'-') plan,(SELECT COUNT(*) FROM devices d WHERE d.customer_id=c.id) devices,(SELECT COUNT(*) FROM commands x WHERE x.customer_id=c.id) commands FROM customers c LEFT JOIN subscriptions s ON s.customer_id=c.id`).all();
  res.json({ customers: rows });
});
app.post('/subscription/webhook', (req, res) => {
  const key = req.headers['x-vertice-webhook-secret']; if (!process.env.WEBHOOK_SECRET || key !== process.env.WEBHOOK_SECRET) return res.status(401).json({ error: 'Webhook não autorizado' });
  const { customerId, status, plan, currentPeriodEnd } = req.body || {}; if (!customerId || !['active','pending','blocked','cancelled'].includes(status)) return res.status(400).json({ error: 'Payload inválido' });
  const now = new Date().toISOString(); const s = subscription(customerId); if (s) db.prepare('UPDATE subscriptions SET plan=?,status=?,current_period_end=?,updated_at=? WHERE id=?').run(plan || s.plan, status, currentPeriodEnd || null, now, s.id); else db.prepare('INSERT INTO subscriptions VALUES(?,?,?,?,?,?)').run(uuid(), customerId, plan || 'basic', status, currentPeriodEnd || null, now);
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`Vértice server na porta ${PORT}`));

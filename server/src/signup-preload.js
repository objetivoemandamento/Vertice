const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const db = new Database(process.env.DB_PATH || 'vertice.db');
const originalListen = express.application.listen;
let installed = false;
const jsonError = (res, status, error) => res.status(status).json({ error });
const jwtSecret = () => process.env.JWT_SECRET || 'vertice-dev-secret-change-me';

function plans() {
  const fallback = [
    { id: 'basic', name: 'Básico', price: 99.90, description: 'Acesso ao VÉRTICE para operação individual.' },
    { id: 'pro', name: 'Profissional', price: 199.90, description: 'Recursos ampliados para operação profissional.' },
    { id: 'business', name: 'Empresarial', price: 499.90, description: 'Estrutura para uso empresarial e múltiplas necessidades.' }
  ];
  try {
    const parsed = JSON.parse(process.env.VERTICE_PLANS_JSON || '');
    if (!Array.isArray(parsed) || !parsed.length) return fallback;
    const clean = parsed.map(p => ({ id: String(p.id || '').trim().toLowerCase(), name: String(p.name || '').trim().slice(0, 60), price: Number(p.price), description: String(p.description || '').trim().slice(0, 240) }))
      .filter(p => /^[a-z0-9_-]{2,30}$/.test(p.id) && p.name && Number.isFinite(p.price) && p.price > 0 && p.price <= 1000000);
    return clean.length ? clean : fallback;
  } catch { return fallback; }
}
function signupToken(saleId) { return crypto.createHmac('sha256', jwtSecret()).update(String(saleId)).digest('hex'); }
function validSignupToken(saleId, provided) { const a = Buffer.from(signupToken(saleId)); const b = Buffer.from(String(provided || '')); return a.length === b.length && crypto.timingSafeEqual(a, b); }
function addMonth() { const d = new Date(); d.setMonth(d.getMonth() + 1); return d.toISOString(); }
async function mp(path, options = {}) {
  if (!process.env.MERCADOPAGO_ACCESS_TOKEN) throw new Error('Mercado Pago não configurado no servidor.');
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(`https://api.mercadopago.com${path}`, { ...options, signal: ctl.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}`, ...(options.headers || {}) } });
    const text = await r.text(); let data = {}; try { data = text ? JSON.parse(text) : {}; } catch {}
    if (!r.ok) { const e = new Error(`Mercado Pago: ${data?.message || data?.error || `HTTP ${r.status}`}`); e.status = r.status; throw e; }
    return data;
  } finally { clearTimeout(timer); }
}
function paymentStatus(order) {
  const orderStatus = String(order?.status || '').toLowerCase();
  const total = Number(order?.total_paid_amount || 0);
  const payments = Array.isArray(order?.transactions?.payments) ? order.transactions.payments : [];
  if ((orderStatus === 'processed' && total > 0) || payments.some(p => ['approved', 'processed', 'accredited'].includes(String(p?.status || '').toLowerCase()))) return 'paid';
  if (['cancelled', 'canceled'].includes(orderStatus)) return 'cancelled';
  if (orderStatus === 'expired') return 'expired';
  return 'pending';
}
async function syncSignup(sale) {
  const order = await mp(`/v1/orders/${encodeURIComponent(sale.mp_order_id)}`);
  const status = paymentStatus(order); const now = new Date().toISOString();
  const payments = Array.isArray(order?.transactions?.payments) ? order.transactions.payments : [];
  const approved = payments.find(p => ['approved', 'processed', 'accredited'].includes(String(p?.status || '').toLowerCase()));
  db.prepare('UPDATE sales SET status=?,mp_payment_id=COALESCE(?,mp_payment_id),paid_at=CASE WHEN ?="paid" THEN COALESCE(paid_at,?) ELSE paid_at END WHERE id=?').run(status, approved?.id ? String(approved.id) : null, status, now, sale.id);
  if (status === 'paid') {
    const sub = db.prepare('SELECT id,plan FROM subscriptions WHERE customer_id=? ORDER BY updated_at DESC LIMIT 1').get(sale.customer_id);
    const plan = sub?.plan || 'basic'; const end = addMonth();
    if (sub) db.prepare('UPDATE subscriptions SET status="active",current_period_end=?,updated_at=? WHERE id=?').run(end, now, sub.id);
    else db.prepare('INSERT INTO subscriptions VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(), sale.customer_id, plan, 'active', end, now);
  }
  return status;
}
function install(app) {
  if (installed || !app || typeof app.post !== 'function') return;
  installed = true;
  app.get('/public/plans', (req, res) => res.json({ plans: plans() }));
  app.post('/public/signup/checkout', async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase(); const password = String(req.body?.password || ''); const planId = String(req.body?.plan || '').trim().toLowerCase(); const selected = plans().find(p => p.id === planId);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || password.length < 8 || password.length > 128 || !selected) return jsonError(res, 400, 'Informe e-mail válido, senha entre 8 e 128 caracteres e um plano válido.');
    if (!process.env.MERCADOPAGO_ACCESS_TOKEN) return jsonError(res, 503, 'Mercado Pago não configurado no servidor.');
    try {
      let customer = db.prepare('SELECT id,password_hash FROM customers WHERE email=?').get(email); const now = new Date().toISOString();
      if (customer) {
        if (!(await bcrypt.compare(password, customer.password_hash))) return jsonError(res, 409, 'Já existe uma conta com este e-mail. Use a senha cadastrada.');
        const current = db.prepare('SELECT id,status FROM subscriptions WHERE customer_id=? ORDER BY updated_at DESC LIMIT 1').get(customer.id);
        if (current?.status === 'active') return jsonError(res, 409, 'Esta conta já possui uma assinatura ativa. Faça login para continuar.');
        if (current) db.prepare('UPDATE subscriptions SET plan=?,status="pending",current_period_end=NULL,updated_at=? WHERE id=?').run(selected.id, now, current.id);
        else db.prepare('INSERT INTO subscriptions VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(), customer.id, selected.id, 'pending', null, now);
      } else {
        const id = crypto.randomUUID(); const hash = await bcrypt.hash(password, 12);
        db.prepare('INSERT INTO customers VALUES(?,?,?,?)').run(id, email, hash, now);
        db.prepare('INSERT INTO subscriptions VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(), id, selected.id, 'pending', null, now);
        customer = { id, password_hash: hash };
      }
      const saleId = crypto.randomUUID(); const externalReference = `VTX-SIGNUP-${customer.id.replace(/-/g, '')}-${saleId.replace(/-/g, '')}`;
      db.prepare('INSERT INTO sales(id,customer_id,amount,product,channel,status,created_at,external_reference) VALUES(?,?,?,?,?,?,?,?)').run(saleId, customer.id, selected.price, `VÉRTICE — ${selected.name}`, 'mercado_pago', 'pending', now, externalReference);
      const order = await mp('/v1/orders', { method: 'POST', headers: { 'X-Idempotency-Key': saleId }, body: JSON.stringify({ type: 'online', total_amount: selected.price.toFixed(2), external_reference: externalReference, processing_mode: 'manual', items: [{ title: `VÉRTICE — ${selected.name}`, description: selected.description, quantity: 1, unit_price: selected.price.toFixed(2) }] }) });
      const orderId = String(order.id || ''); const checkoutUrl = String(order.checkout_url || ''); if (!orderId || !checkoutUrl) throw new Error('Mercado Pago não retornou o checkout.');
      db.prepare('UPDATE sales SET mp_order_id=?,checkout_url=? WHERE id=?').run(orderId, checkoutUrl, saleId);
      db.prepare('INSERT INTO payment_orders VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(), saleId, customer.id, 'mercado_pago', orderId, null, 'pending', selected.price, checkoutUrl, now, now);
      return res.status(201).json({ signupId: saleId, signupToken: signupToken(saleId), plan: selected.id, amount: selected.price, checkoutUrl });
    } catch (e) { return res.status(e.status && e.status < 500 ? e.status : 502).json({ error: e.message || 'Não foi possível iniciar o pagamento.' }); }
  });
  app.get('/public/signup/status', async (req, res) => {
    const signupId = String(req.query?.signupId || '').trim(); const provided = String(req.query?.token || '').trim();
    if (!signupId || !validSignupToken(signupId, provided)) return jsonError(res, 401, 'Verificação de pagamento inválida.');
    const sale = db.prepare('SELECT * FROM sales WHERE id=?').get(signupId); if (!sale || !sale.mp_order_id) return jsonError(res, 404, 'Pagamento não encontrado.');
    try {
      const status = await syncSignup(sale); if (status !== 'paid') return res.json({ status });
      const customer = db.prepare('SELECT id,email FROM customers WHERE id=?').get(sale.customer_id); const token = jwt.sign({ sub: customer.id, email: customer.email, role: 'CUSTOMER' }, jwtSecret(), { expiresIn: '30d' });
      const sub = db.prepare('SELECT plan FROM subscriptions WHERE customer_id=? ORDER BY updated_at DESC LIMIT 1').get(customer.id);
      return res.json({ status: 'paid', token, customer: { id: customer.id, email: customer.email }, plan: sub?.plan || 'basic' });
    } catch (e) { return res.status(502).json({ error: e.message || 'Não foi possível verificar o pagamento.' }); }
  });
}
express.application.listen = function (...args) { install(this); return originalListen.apply(this, args); };

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { query, withTransaction, waitForDatabase, closeDatabase } = require('./db');
const { VERTICE_MARKETS } = require('./markets');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

const PORT = Number(process.env.PORT || 8080);
const NODE_ENV = process.env.NODE_ENV || 'development';
const JWT_SECRET = String(process.env.JWT_SECRET || '').trim();
const JWT_ISSUER = process.env.JWT_ISSUER || 'vertice';
const ACCESS_TTL = process.env.JWT_ACCESS_TTL || '30d';
const REFRESH_TTL_DAYS = Math.max(1, Number(process.env.JWT_REFRESH_DAYS || 90));
const OWNER_LOGIN = String(process.env.OWNER_LOGIN || '').trim();
const OWNER_PASSWORD = String(process.env.OWNER_PASSWORD || '');
const LOGIN_LIMITS = new Map();

if (NODE_ENV === 'production') {
  if (!JWT_SECRET || JWT_SECRET.length < 32) throw new Error('JWT_SECRET deve ter pelo menos 32 caracteres em produção.');
  if (!OWNER_LOGIN || OWNER_PASSWORD.length < 12) throw new Error('OWNER_LOGIN e OWNER_PASSWORD seguros são obrigatórios em produção.');
}

const marketMap = new Map(VERTICE_MARKETS.map(m => [m.countryCode, m]));

function errorJson(res, status, error, code) {
  return res.status(status).json({ error, ...(code ? { code } : {}) });
}
function now() { return new Date(); }
function iso() { return now().toISOString(); }
function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : NaN;
}
function normalizeMarket(countryCode, locale, currencyCode) {
  const byCountry = marketMap.get(String(countryCode || 'BR').toUpperCase());
  if (!byCountry) return null;
  if (locale && String(locale) !== byCountry.locale) return null;
  if (currencyCode && String(currencyCode).toUpperCase() !== byCountry.currencyCode) return null;
  return byCountry;
}
function month(value) {
  const m = String(value || new Date().toISOString().slice(0, 7));
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(m) ? m : null;
}
function limitLogin(key) {
  const t = Date.now();
  const current = LOGIN_LIMITS.get(key);
  if (!current || t - current.t >= 60000) { LOGIN_LIMITS.set(key, { t, n: 1 }); return true; }
  current.n += 1;
  return current.n <= 10;
}
function signAccess(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TTL, issuer: JWT_ISSUER, audience: 'vertice-app' });
}
function signRefresh(payload) {
  return jwt.sign({ ...payload, type: 'refresh' }, JWT_SECRET, { expiresIn: REFRESH_TTL_DAYS + 'd', issuer: JWT_ISSUER, audience: 'vertice-refresh' });
}
function verifyAccess(token) {
  return jwt.verify(token, JWT_SECRET, { issuer: JWT_ISSUER, audience: 'vertice-app' });
}
function verifyRefresh(token) {
  return jwt.verify(token, JWT_SECRET, { issuer: JWT_ISSUER, audience: 'vertice-refresh' });
}
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
function auth(req, res, next) {
  try {
    const h = String(req.headers.authorization || '');
    if (!h.startsWith('Bearer ')) return errorJson(res, 401, 'Não autenticado.', 'AUTH_REQUIRED');
    req.user = verifyAccess(h.slice(7));
    next();
  } catch {
    return errorJson(res, 401, 'Sessão inválida ou expirada.', 'AUTH_EXPIRED');
  }
}
function ownerOnly(req, res, next) {
  if (req.user?.role !== 'OWNER') return errorJson(res, 403, 'Acesso de proprietário necessário.');
  next();
}
async function currentSubscription(userId) {
  const r = await query('select * from subscriptions where user_id=$1 order by updated_at desc limit 1', [userId]);
  return r.rows[0] || null;
}
async function activeSubscription(userId) {
  const s = await currentSubscription(userId);
  return Boolean(s && s.status === 'active' && (!s.current_period_end || new Date(s.current_period_end) >= now()));
}
function userId(req) { return req.user.role === 'OWNER' ? null : req.user.sub; }
function externalReference(userIdValue, paymentId) {
  return 'VTX-' + String(userIdValue).replace(/-/g, '').toLowerCase() + '-' + String(paymentId).replace(/-/g, '').toLowerCase();
}
function parseSignatureHeader(value) {
  const out = {};
  String(value || '').split(',').forEach(part => {
    const [key, ...rest] = part.split('=');
    if (key && rest.length) out[key.trim()] = rest.join('=').trim();
  });
  return out;
}
function validMercadoPagoWebhook(req) {
  const secret = String(process.env.MERCADOPAGO_WEBHOOK_SECRET || '');
  if (!secret) return false;
  const signature = parseSignatureHeader(req.headers['x-signature']);
  const requestId = String(req.headers['x-request-id'] || '');
  const dataId = String(req.query['data.id'] || req.body?.data?.id || '');
  const ts = String(signature.ts || '');
  const v1 = String(signature.v1 || '');
  const tsMs = Number(ts) * 1000;
  if (!requestId || !dataId || !ts || !v1 || !Number.isFinite(tsMs) || Math.abs(Date.now() - tsMs) > 600000) return false;
  const manifest = 'id:' + dataId + ';request-id:' + requestId + ';ts:' + ts + ';';
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  const a = Buffer.from(expected); const b = Buffer.from(v1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
async function providerFetch(base, path, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(base + path, { ...options, signal: controller.signal });
    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch {}
    if (!response.ok) {
      const e = new Error(data?.message || data?.error || ('HTTP ' + response.status));
      e.status = response.status;
      e.provider = data;
      throw e;
    }
    return data;
  } finally { clearTimeout(timer); }
}
async function mercadoPago(path, options = {}) {
  const token = String(process.env.MERCADOPAGO_ACCESS_TOKEN || '');
  if (!token) throw Object.assign(new Error('Mercado Pago não configurado.'), { status: 503 });
  return providerFetch('https://api.mercadopago.com', path, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...(options.headers || {}) }
  });
}
async function stripe(path, options = {}) {
  const token = String(process.env.STRIPE_SECRET_KEY || '');
  if (!token) throw Object.assign(new Error('Stripe não configurado.'), { status: 503 });
  return providerFetch('https://api.stripe.com', path, {
    ...options,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Bearer ' + token, ...(options.headers || {}) }
  });
}
function stripeForm(values) {
  return new URLSearchParams(values).toString();
}
async function updatePaymentByProvider(provider, providerPaymentId, status, paidAt = null) {
  await query('update payments set status=$1, paid_at=case when $2 is not null then coalesce(paid_at,$2) else paid_at end, updated_at=now() where provider=$3 and (provider_payment_id=$4 or provider_order_id=$4)', [status, paidAt, provider, providerPaymentId]);
}
async function syncMercadoPagoPayment(paymentId) {
  const order = await mercadoPago('/v1/orders/' + encodeURIComponent(paymentId));
  const payments = Array.isArray(order?.transactions?.payments) ? order.transactions.payments : [];
  const approved = payments.find(p => ['approved','processed','accredited'].includes(String(p?.status || '').toLowerCase()));
  const status = (String(order?.status || '').toLowerCase() === 'processed' && Number(order?.total_paid_amount || 0) > 0) || approved ? 'paid' :
    ['cancelled','canceled'].includes(String(order?.status || '').toLowerCase()) ? 'cancelled' :
    String(order?.status || '').toLowerCase() === 'expired' ? 'expired' : 'pending';
  await query('update payments set status=$1, provider_payment_id=coalesce($2,provider_payment_id), paid_at=case when $1=\'paid\' then coalesce(paid_at,now()) else paid_at end, updated_at=now() where provider=\'mercado_pago\' and provider_order_id=$3',
    [status, approved?.id ? String(approved.id) : null, String(paymentId)]);
  return { status, order };
}

app.post('/webhooks/stripe', express.raw({ type: 'application/json', limit: '2mb' }), async (req, res) => {
  const secret = String(process.env.STRIPE_WEBHOOK_SECRET || '');
  if (!secret) return errorJson(res, 503, 'Stripe webhook não configurado.');
  const signature = String(req.headers['stripe-signature'] || '');
  if (!signature) return errorJson(res, 400, 'Assinatura Stripe ausente.');
  // Signature verification is performed without a Stripe SDK to keep the backend lean.
  // The endpoint accepts only events whose timestamped HMAC matches STRIPE_WEBHOOK_SECRET.
  const parts = Object.fromEntries(signature.split(',').map(x => x.split('=')));
  const timestamp = Number(parts.t);
  const provided = String(parts.v1 || '');
  if (!Number.isFinite(timestamp) || !provided || Math.abs(Date.now()/1000 - timestamp) > 300) return errorJson(res, 400, 'Assinatura Stripe expirada.');
  const payload = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  const signed = timestamp + '.' + payload;
  const expected = crypto.createHmac('sha256', secret).update(signed).digest('hex');
  if (expected.length !== provided.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided))) return errorJson(res, 400, 'Assinatura Stripe inválida.');
  try {
    const event = JSON.parse(payload);
    const object = event.data?.object || {};
    const providerId = String(object.payment_intent || object.id || '');
    const eventType = String(event.type || '');
    let status = null;
    if (/succeeded|paid|completed/.test(eventType)) status = 'paid';
    else if (/failed|canceled|cancelled/.test(eventType)) status = eventType.includes('cancel') ? 'cancelled' : 'failed';
    if (providerId && status) await updatePaymentByProvider('stripe', providerId, status, status === 'paid' ? new Date() : null);
    return res.json({ received: true });
  } catch (e) { return errorJson(res, 400, 'Webhook Stripe inválido.'); }
});

app.use(cors());
app.use(express.json({ limit: '8mb', strict: true }));

app.get('/health', async (req, res) => {
  try {
    const started = Date.now();
    await query('select 1 as ok');
    res.json({ ok: true, service: 'vertice', version: '1.5.0', database: 'postgresql', databaseLatencyMs: Date.now()-started, capabilities: ['comando','operacao','monitoramento','ai','mercado_pago','stripe','jwt_refresh'], markets: VERTICE_MARKETS.map(m => m.countryCode) });
  } catch (e) {
    res.status(503).json({ ok: false, service: 'vertice', database: 'unavailable', error: 'Banco indisponível.' });
  }
});
app.get('/markets', (req, res) => res.json({ ok: true, defaultCountry: 'BR', markets: VERTICE_MARKETS }));

app.post('/auth/register', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const market = normalizeMarket(req.body?.countryCode, req.body?.locale, req.body?.currencyCode);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || password.length < 8 || password.length > 128 || !market) return errorJson(res, 400, 'E-mail, senha ou mercado inválido.');
  try {
    const hash = await bcrypt.hash(password, 12);
    const result = await withTransaction(async client => {
      const user = await client.query('insert into users(email,password_hash,country_code,locale) values($1,$2,$3,$4) returning id,email,country_code,locale', [email, hash, market.countryCode, market.locale]);
      const u = user.rows[0];
      await client.query('insert into subscriptions(user_id,plan,status) values($1,$2,$3)', [u.id, 'basic', 'pending']);
      return u;
    });
    const u = result;
    const accessToken = signAccess({ sub: u.id, email: u.email, role: 'CUSTOMER' });
    const refreshToken = await issueRefreshToken(u.id, 'CUSTOMER');
    res.status(201).json({ token: accessToken, refreshToken, role: 'CUSTOMER', customer: { id: u.id, email: u.email }, market });
  } catch (e) {
    if (e.code === '23505') return errorJson(res, 409, 'Conta já existente.');
    console.error('[auth/register]', e.message);
    return errorJson(res, 500, 'Não foi possível criar a conta.');
  }
});

async function issueRefreshToken(subject, role) {
  const token = signRefresh({ sub: subject, role });
  if (role === 'OWNER') return token;
  await query('insert into refresh_tokens(user_id,token_hash,expires_at) values($1,$2,now()+($3::text || \' days\')::interval)', [subject, hashToken(token), REFRESH_TTL_DAYS]);
  return token;
}

app.post('/auth/login', async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (!limitLogin('login:' + ip)) return errorJson(res, 429, 'Muitas tentativas. Aguarde um momento.');
  const login = String(req.body?.login || req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (OWNER_LOGIN && login === OWNER_LOGIN.toLowerCase() && OWNER_PASSWORD && password === OWNER_PASSWORD) {
    const token = signAccess({ sub: 'owner', email: OWNER_LOGIN, role: 'OWNER' });
    return res.json({ token, refreshToken: await issueRefreshToken('owner', 'OWNER'), role: 'OWNER', customer: { id: 'owner', email: OWNER_LOGIN } });
  }
  try {
    const r = await query('select id,email,password_hash,country_code,locale from users where email=$1', [login]);
    const c = r.rows[0];
    if (!c || !(await bcrypt.compare(password, c.password_hash))) return errorJson(res, 401, 'Login ou senha inválidos.');
    const token = signAccess({ sub: c.id, email: c.email, role: 'CUSTOMER' });
    const refreshToken = await issueRefreshToken(c.id, 'CUSTOMER');
    res.json({ token, refreshToken, role: 'CUSTOMER', customer: { id: c.id, email: c.email }, market: marketMap.get(c.country_code) || marketMap.get('BR') });
  } catch (e) { console.error('[auth/login]', e.message); return errorJson(res, 500, 'Falha de autenticação.'); }
});

app.post('/auth/refresh', async (req, res) => {
  const token = String(req.body?.refreshToken || '');
  if (!token) return errorJson(res, 400, 'refreshToken é obrigatório.');
  try {
    const payload = verifyRefresh(token);
    if (payload.type !== 'refresh') throw new Error('invalid');
    if (payload.role === 'OWNER') return res.json({ token: signAccess({ sub: 'owner', email: OWNER_LOGIN, role: 'OWNER' }), refreshToken: token, role: 'OWNER' });
    const found = await query('select user_id from refresh_tokens where token_hash=$1 and revoked_at is null and expires_at>now()', [hashToken(token)]);
    if (!found.rows[0]) return errorJson(res, 401, 'Refresh token inválido ou revogado.');
    await query('update refresh_tokens set revoked_at=now() where token_hash=$1', [hashToken(token)]);
    const newRefresh = await issueRefreshToken(payload.sub, 'CUSTOMER');
    const u = (await query('select id,email from users where id=$1', [payload.sub])).rows[0];
    if (!u) return errorJson(res, 401, 'Usuário não encontrado.');
    return res.json({ token: signAccess({ sub: u.id, email: u.email, role: 'CUSTOMER' }), refreshToken: newRefresh, role: 'CUSTOMER' });
  } catch { return errorJson(res, 401, 'Refresh token inválido ou expirado.'); }
});

app.get('/me', auth, async (req, res) => {
  if (req.user.role === 'OWNER') return res.json({ role: 'OWNER', customer: { id: 'owner', email: req.user.email }, subscription: { plan: 'owner', status: 'active', currentPeriodEnd: null } });
  const u = (await query('select id,email,country_code,locale from users where id=$1', [req.user.sub])).rows[0];
  if (!u) return errorJson(res, 404, 'Usuário não encontrado.');
  const s = await currentSubscription(u.id);
  res.json({ role: 'CUSTOMER', customer: { id: u.id, email: u.email }, market: marketMap.get(u.country_code) || marketMap.get('BR'), subscription: s ? { plan: s.plan, status: s.status, currentPeriodEnd: s.current_period_end } : null });
});

app.post('/devices/register', auth, async (req, res) => {
  if (req.user.role !== 'CUSTOMER') return errorJson(res, 403, 'Use o terminal do proprietário.');
  const id = String(req.body?.deviceId || '').trim();
  const mode = String(req.body?.mode || '').trim();
  const name = String(req.body?.deviceName || '').trim().slice(0,100);
  if (!id || !['comando','operacao','monitoramento'].includes(mode)) return errorJson(res, 400, 'deviceId e mode são obrigatórios.');
  await query('insert into devices(id,user_id,device_name,mode,last_seen_at) values($1,$2,$3,$4,now()) on conflict(id) do update set user_id=excluded.user_id,device_name=excluded.device_name,mode=excluded.mode,last_seen_at=now()', [id, req.user.sub, name, mode]);
  res.json({ ok:true, deviceId:id, mode });
});
app.get('/devices', auth, async (req, res) => {
  const cid = userId(req);
  if (!cid) return res.json({ devices: [] });
  const rows = (await query('select id,device_name as "deviceName",mode,last_seen_at as "lastSeenAt",created_at as "createdAt" from devices where user_id=$1 order by last_seen_at desc', [cid])).rows;
  res.json({ devices: rows });
});

app.post('/commands', auth, async (req,res) => {
  if (!(await activeSubscription(req.user.sub))) return errorJson(res,402,'Assinatura não está ativa.');
  const command=String(req.body?.command||'').trim(), mode=String(req.body?.mode||''), deviceId=String(req.body?.deviceId||'').trim();
  if(!command||command.length>2000||!['comando','operacao','monitoramento'].includes(mode)||!deviceId)return errorJson(res,400,'Comando, modo ou deviceId inválido.');
  const d=(await query('select user_id,mode from devices where id=$1',[deviceId])).rows[0];
  if(!d||d.user_id!==req.user.sub)return errorJson(res,403,'Dispositivo não pertence à conta.');
  if(mode==='operacao'&&d.mode!=='operacao')return errorJson(res,409,'O dispositivo não está em OPERAÇÃO.');
  const r=await query('insert into commands(user_id,device_id,mode,command,status) values($1,$2,$3,$4,\'queued\') returning id,status',[req.user.sub,deviceId,mode,command]);
  res.status(202).json({id:r.rows[0].id,status:r.rows[0].status,message:'Comando recebido pelo VÉRTICE.'});
});
app.get('/commands',auth,async(req,res)=>{const cid=userId(req);if(!cid)return res.json({commands:[]});const rows=(await query('select id,device_id as "deviceId",mode,command,status,created_at as "createdAt" from commands where user_id=$1 order by created_at desc limit 50',[cid])).rows;res.json({commands:rows});});
app.get('/commands/next',auth,async(req,res)=>{if(!(await activeSubscription(req.user.sub)))return errorJson(res,402,'Assinatura não está ativa.');const deviceId=String(req.query?.deviceId||'').trim();const d=(await query('select id,user_id,mode from devices where id=$1',[deviceId])).rows[0];if(!d||d.user_id!==req.user.sub||d.mode!=='operacao')return errorJson(res,403,'Terminal OPERAÇÃO não autorizado.');await query('update devices set last_seen_at=now() where id=$1',[deviceId]);const r=await query('update commands set status=\'running\',updated_at=now() where id=(select id from commands where user_id=$1 and device_id=$2 and mode=\'operacao\' and status=\'queued\' order by created_at asc for update skip locked limit 1) returning id,command,mode,status',[req.user.sub,deviceId]);res.json({ok:true,command:r.rows[0]||null});});
app.post('/commands/:commandId/status',auth,async(req,res)=>{if(!(await activeSubscription(req.user.sub)))return errorJson(res,402,'Assinatura não está ativa.');const id=String(req.params.commandId),status=String(req.body?.status||'').toLowerCase(),deviceId=String(req.body?.deviceId||'');if(!['completed','failed','cancelled'].includes(status)||!deviceId)return errorJson(res,400,'Status ou deviceId inválido.');const r=await query('update commands set status=$1,updated_at=now() where id=$2 and user_id=$3 and device_id=$4 and status=\'running\' returning status',[status,id,req.user.sub,deviceId]);if(!r.rows[0])return errorJson(res,404,'Comando não encontrado.');res.json({ok:true,status:r.rows[0].status});});

function plans() {
  const fallback=[{id:'basic',name:'Básico',price:99.90,description:'Acesso ao VÉRTICE para operação individual.'},{id:'pro',name:'Profissional',price:199.90,description:'Recursos ampliados para operação profissional.'},{id:'business',name:'Empresarial',price:499.90,description:'Estrutura para uso empresarial.'}];
  try{const p=JSON.parse(process.env.VERTICE_PLANS_JSON||'');return Array.isArray(p)&&p.length?p:fallback;}catch{return fallback;}
}
app.get('/public/plans',(req,res)=>res.json({plans:plans(),markets:VERTICE_MARKETS}));

app.post('/public/signup/checkout',async(req,res)=>{
  const email=String(req.body?.email||'').trim().toLowerCase(),password=String(req.body?.password||''),planId=String(req.body?.plan||'').trim().toLowerCase();
  const market=normalizeMarket(req.body?.countryCode,req.body?.locale,req.body?.currencyCode);const selected=plans().find(p=>p.id===planId);
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)||password.length<8||!selected||!market)return errorJson(res,400,'E-mail, senha, plano ou mercado inválido.');
  const amount=money(req.body?.amount ?? selected.price);if(!Number.isFinite(amount)||amount<=0)return errorJson(res,400,'Valor inválido.');
  try{
    const hash=await bcrypt.hash(password,12);
    const u=await withTransaction(async client=>{
      let found=(await client.query('select id,password_hash from users where email=$1',[email])).rows[0];
      if(found){if(!(await bcrypt.compare(password,found.password_hash)))throw Object.assign(new Error('Conta existente.'),{status:409});}
      else found=(await client.query('insert into users(email,password_hash,country_code,locale) values($1,$2,$3,$4) returning id,password_hash',[email,hash,market.countryCode,market.locale])).rows[0];
      const s=(await client.query('select id,status from subscriptions where user_id=$1 order by updated_at desc limit 1',[found.id])).rows[0];
      if(s)await client.query('update subscriptions set plan=$1,status=\'pending\',current_period_start=null,current_period_end=null,updated_at=now() where id=$2',[selected.id,s.id]);
      else await client.query('insert into subscriptions(user_id,plan,status) values($1,$2,\'pending\')',[found.id,selected.id]);
      return found;
    });
    const payment=(await query('insert into payments(user_id,provider,external_reference,amount,currency_code,status) values($1,$2,$3,$4,$5,\'pending\') returning id',[u.id,market.countryCode==='BR'||market.countryCode==='MX'?'mercado_pago':'stripe',null,amount,market.currencyCode])).rows[0];
    const ref=externalReference(u.id,payment.id);
    await query('update payments set external_reference=$1 where id=$2',[ref,payment.id]);
    if(market.countryCode==='BR'||market.countryCode==='MX'){
      const order=await mercadoPago('/v1/orders',{method:'POST',headers:{'X-Idempotency-Key':String(payment.id)},body:JSON.stringify({type:'online',total_amount:amount.toFixed(2),external_reference:ref,processing_mode:'manual',items:[{title:'VÉRTICE — '+selected.name,description:selected.description,quantity:1,unit_price:amount.toFixed(2)}]})});
      const orderId=String(order.id||''),checkoutUrl=String(order.checkout_url||'');if(!orderId||!checkoutUrl)throw new Error('Mercado Pago não retornou checkout.');
      await query('update payments set provider_order_id=$1,checkout_url=$2 where id=$3',[orderId,checkoutUrl,payment.id]);
      return res.status(201).json({paymentId:payment.id,provider:'mercado_pago',plan:selected.id,amount,currency:market.currencyCode,checkoutUrl});
    }
    const params=stripeForm({'mode':'payment','success_url':String(process.env.PUBLIC_APP_SUCCESS_URL||'https://vertice-backend-8gj5.onrender.com/payment/success'),'cancel_url':String(process.env.PUBLIC_APP_CANCEL_URL||'https://vertice-backend-8gj5.onrender.com/payment/cancel'),'line_items[0][price_data][currency]':market.currencyCode.toLowerCase(),'line_items[0][price_data][product_data][name]':'VÉRTICE — '+selected.name,'line_items[0][price_data][unit_amount]':String(Math.round(amount*100)),'line_items[0][quantity]':'1','metadata[payment_id]':String(payment.id),'metadata[external_reference]':ref});
    const session=await stripe('/v1/checkout/sessions',{method:'POST',body:params});
    await query('update payments set provider_order_id=$1,checkout_url=$2 where id=$3',[String(session.id),String(session.url||''),payment.id]);
    return res.status(201).json({paymentId:payment.id,provider:'stripe',plan:selected.id,amount,currency:market.currencyCode,checkoutUrl:session.url});
  }catch(e){console.error('[checkout]',e.message);return errorJson(res,e.status&&e.status<500?e.status:502,e.message||'Falha ao iniciar cobrança.');}
});

app.get('/public/payment/status',async(req,res)=>{const id=String(req.query?.paymentId||'').trim();if(!id)return errorJson(res,400,'paymentId obrigatório.');const p=(await query('select * from payments where id=$1',[id])).rows[0];if(!p)return errorJson(res,404,'Pagamento não encontrado.');try{if(p.provider==='mercado_pago'&&p.provider_order_id)await syncMercadoPagoPayment(p.provider_order_id);const fresh=(await query('select status,currency_code,amount,checkout_url from payments where id=$1',[id])).rows[0];if(fresh?.status==='paid')await query('update subscriptions set status=\'active\',current_period_start=coalesce(current_period_start,now()),current_period_end=now()+interval \'1 month\',updated_at=now() where user_id=$1 and status in (\'pending\',\'active\')',[p.user_id]);res.json({paymentId:id,...fresh});}catch(e){return errorJson(res,502,e.message||'Falha ao verificar pagamento.');}});

app.post('/webhooks/mercadopago',async(req,res)=>{if(!validMercadoPagoWebhook(req))return errorJson(res,401,'Webhook Mercado Pago inválido.');const id=String(req.query['data.id']||req.body?.data?.id||'');if(!id)return res.json({received:true});try{await syncMercadoPagoPayment(id);return res.json({received:true});}catch(e){return errorJson(res,502,'Falha ao sincronizar Mercado Pago.');}});

app.get('/sales',auth,async(req,res)=>{const m=month(req.query?.month);if(!m)return errorJson(res,400,'Mês inválido.');const rows=(await query('select id,amount,currency_code as currency,provider,status,checkout_url as "checkoutUrl",paid_at as "paidAt",created_at as "createdAt" from payments where user_id=$1 and to_char(created_at,\'YYYY-MM\')=$2 order by created_at desc limit 100',[req.user.sub,m])).rows;res.json({month:m,sales:rows});});
app.post('/sales/orders',auth,async(req,res)=>{const product=String(req.body?.product||'').trim().slice(0,120),amount=money(req.body?.amount),market=normalizeMarket(req.body?.countryCode||'BR',req.body?.locale,req.body?.currencyCode);if(!product||!Number.isFinite(amount)||amount<=0||!market)return errorJson(res,400,'Produto, valor ou mercado inválido.');req.body={...req.body,plan:product};return res.redirect(307,'/public/signup/checkout');});

app.post('/ai/agent/chat',auth,async(req,res)=>{
  if(req.user.role!=='OWNER'&&!(await activeSubscription(req.user.sub)))return errorJson(res,402,'Assinatura não está ativa.');
  const message=String(req.body?.message||'').trim().slice(0,6000),mode=String(req.body?.mode||'');
  if(!message||!['comando','operacao','monitoramento'].includes(mode))return errorJson(res,400,'Mensagem ou modo inválido.');
  const key=String(process.env.VERTICE_AI_API_KEY||process.env.GROQ_API_KEY||process.env.OPENAI_API_KEY||'');
  const base=String(process.env.VERTICE_AI_BASE_URL||(process.env.GROQ_API_KEY?'https://api.groq.com/openai/v1':process.env.OPENAI_API_KEY?'https://api.openai.com/v1':'')).replace(/\/$/,'');
  let answer='Comando recebido. Vou separar objetivo, contexto, evidências e próxima ação, preservando o que não foi solicitado.';
  if(key&&base){try{const model=process.env.VERTICE_AI_MODEL||(process.env.GROQ_API_KEY?'llama-3.3-70b-versatile':'gpt-4o-mini');const data=await providerFetch(base,'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify({model,temperature:0.2,messages:[{role:'system',content:'Você é o VÉRTICE, IA operacional e estratégica. Responda em português, não invente dados, diferencie fatos de hipóteses e não revele credenciais.'},{role:'user',content:message}]})},20000);answer=String(data?.choices?.[0]?.message?.content||answer).slice(0,12000);}catch(e){console.error('[ai]',e.message);}}
  if(req.user.role!=='OWNER')await query('insert into ai_conversations(user_id,mode,role,content) values($1,$2,\'user\',$3),($1,$2,\'assistant\',$4)',[req.user.sub,mode,message,answer]);
  res.json({ok:true,answer,intent:'analysis',confidence:0.5,plan:['entender objetivo','avaliar contexto','definir próxima ação'],actions:[{type:'analyze',label:'Analisar e estruturar'}],shouldExecute:mode==='operacao',mode});
});
app.get('/ai/agent/history',auth,async(req,res)=>{if(req.user.role==='OWNER')return res.json({ok:true,history:[]});const rows=(await query('select role,content,mode,created_at as "createdAt" from ai_conversations where user_id=$1 order by created_at desc limit 100',[req.user.sub])).rows.reverse();res.json({ok:true,history:rows});});

app.get('/admin/overview',auth,ownerOnly,async(req,res)=>{const [customers,subs,devices,commands,sales]=await Promise.all([query('select count(*)::int n from users'),query("select count(*)::int n from subscriptions where status='active'"),query('select count(*)::int n from devices'),query("select count(*)::int n from commands where created_at>=current_date"),query("select coalesce(sum(amount),0) n from payments where status='paid' and to_char(created_at,'YYYY-MM')=to_char(current_date,'YYYY-MM')")]);res.json({customers:customers.rows[0].n,activeSubscriptions:subs.rows[0].n,devices:devices.rows[0].n,commandsToday:commands.rows[0].n,salesMonth:Number(sales.rows[0].n||0)});});

app.use((err,req,res,next)=>{console.error('[vertice]',err);if(res.headersSent)return next(err);return errorJson(res,500,'Erro interno do servidor.');});

async function start() {
  await waitForDatabase();
  const server=app.listen(PORT,()=>console.log('VÉRTICE backend ouvindo na porta '+PORT));
  const shutdown=async(signal)=>{console.log('[vertice] '+signal);server.close(async()=>{try{await closeDatabase();}finally{process.exit(0);}});};
  process.once('SIGTERM',()=>shutdown('SIGTERM'));process.once('SIGINT',()=>shutdown('SIGINT'));
}
start().catch(err=>{console.error('[vertice] startup failed:',err.message);process.exit(1);});

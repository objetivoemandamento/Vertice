const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { query, withTransaction, runWithTenantContext, waitForDatabase, closeDatabase } = require('./db');
const { VERTICE_MARKETS } = require('./markets');
const { buildCorsOptions, buildRateLimiter, tenantContextMiddleware } = require('./security/edge');
const { redis } = require('./queue/redis');
const { enqueueExecution } = require('./queue/executionQueue');
const { enrollMfa, enableMfa, verifyEnabledMfa } = require('./security/mfa');
const { issuePaymentCapability, verifyPaymentCapability } = require('./security/paymentCapability');
const { safeError, safeLog } = require('./observability/redaction');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.get(['/download-apk','/download/vertice.apk'], async (req, res) => {
  const apkUrl = 'https://github.com/objetivoemandamento/Vertice/releases/download/android-172/app-release.apk';
  try {
    const response = await fetch(apkUrl, { redirect: 'follow' });
    if (!response.ok || !response.body) return errorJson(res, 502, 'APK indisponível no momento.');
    res.status(200);
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', 'attachment; filename="vertice-1.5.0.apk"');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    const { Readable } = require('stream');
    Readable.fromWeb(response.body).pipe(res);
  } catch (e) {
    return errorJson(res, 502, 'Não foi possível disponibilizar o APK.');
  }
});


const PORT = Number(process.env.PORT || 8080);
const NODE_ENV = process.env.NODE_ENV || 'development';
const JWT_SECRET = String(process.env.JWT_SECRET || '').trim();
const JWT_ISSUER = process.env.JWT_ISSUER || 'vertice';
const ACCESS_TTL = process.env.JWT_ACCESS_TTL || '10m';
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
async function tenantIdForUser(id) {
  const result = await query('select app_tenant_for_user($1) as tenant_id', [id]);
  const tenantId = result.rows[0]?.tenant_id;
  if (!tenantId) throw new Error('TENANT_NOT_FOUND');
  return tenantId;
}
async function ensureTenantForUser(id,name) {
  const existing=await query('select app_tenant_for_user($1) as tenant_id',[id]);
  if(existing.rows[0]?.tenant_id)return existing.rows[0].tenant_id;
  const created=(await query('select app_create_tenant_for_user($1,$2) as tenant_id',[id,String(name||id).slice(0,200)])).rows[0]?.tenant_id;
  if(!created)throw new Error('TENANT_BOOTSTRAP_FAILED');
  return created;
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
const OWNER_SYSTEM_EMAIL = 'owner@system.vertice.local';

async function registerDeviceNow({tenantId,userId,deviceId,mode,deviceName,allowRebind=false}) {
  const { evaluatePolicy } = require('./security/policyEngine');
  const intent = {
    actionId: crypto.randomUUID(), tenantId: String(tenantId), actorUserId: String(userId),
    type: 'device', resource: 'device', operation: 'create',
    payload: { action:'register_device', deviceId:String(deviceId), deviceName:String(deviceName||''), mode:String(mode), userId:String(userId) },
    idempotencyKey: 'device-register-' + String(deviceId)
  };
  if (!evaluatePolicy(intent).allowed) throw new Error('POLICY_DENIED');
  return withTransaction(async client => {
    const existing=(await client.query('select tenant_id,user_id from devices where id=$1 for update',[String(deviceId)])).rows[0];
    if(existing && String(existing.tenant_id)!==String(tenantId)) throw new Error('DEVICE_CROSS_TENANT');
    if(existing && String(existing.user_id)!==String(userId) && !allowRebind) throw new Error('DEVICE_NOT_OWNED');
    await client.query(
      `insert into devices(id,user_id,tenant_id,device_name,mode,last_seen_at)
       values($1,$2,$3,$4,$5,now())
       on conflict(id) do update set user_id=excluded.user_id,tenant_id=excluded.tenant_id,device_name=excluded.device_name,mode=excluded.mode,last_seen_at=now()`,
      [String(deviceId),String(userId),String(tenantId),String(deviceName||''),String(mode)]
    );
    return {deviceId:String(deviceId),mode:String(mode),status:'registered'};
  });
}
async function tenantEmergencyStopped(tenantId) {
  return Boolean((await query('select emergency_stop from tenants where id=$1',[String(tenantId)])).rows[0]?.emergency_stop);
}


async function ensureOwnerIdentity() {
  const existing = (await query('select id from users where email=$1', [OWNER_SYSTEM_EMAIL])).rows[0];
  if (existing?.id) {
    const tenantId=await ensureTenantForUser(existing.id,'VÉRTICE Owner');
    await runWithTenantContext({tenantId,userId:String(existing.id),role:'OWNER',requestId:crypto.randomUUID()},async()=>{const sub=await query('select id from subscriptions where user_id=$1 and status=\'active\' limit 1',[existing.id]);if(!sub.rows[0])await query('insert into subscriptions(user_id,tenant_id,plan,status,provider,current_period_start,current_period_end) values($1,$2,\'owner\',\'active\',\'internal\',now(),null)',[existing.id,tenantId]);});
    return existing.id;
  }
  const passwordHash = await bcrypt.hash(OWNER_PASSWORD || crypto.randomUUID(), 10);
  const created = (await query('insert into users(email,password_hash,full_name,country_code,locale) values($1,$2,$3,\'BR\',\'pt-BR\') returning id', [OWNER_SYSTEM_EMAIL,passwordHash,'VÉRTICE Owner'])).rows[0];
  const tenantId=await ensureTenantForUser(created.id,'VÉRTICE Owner');
  await runWithTenantContext({tenantId,userId:String(created.id),role:'OWNER',requestId:crypto.randomUUID()},async()=>query('insert into subscriptions(user_id,tenant_id,plan,status,provider,current_period_start,current_period_end) values($1,$2,\'owner\',\'active\',\'internal\',now(),null)',[created.id,tenantId]));
  return created.id;
}

async function currentSubscription(userId) {
  const r = await query('select * from subscriptions where user_id=$1 order by updated_at desc limit 1', [userId]);
  return r.rows[0] || null;
}
async function activeSubscription(userId) {
  const s = await currentSubscription(userId);
  return Boolean(s && s.status === 'active' && (!s.current_period_end || new Date(s.current_period_end) >= now()));
}
function userId(req) { return req.user.sub; }
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
      const detail = data?.message || data?.error || data?.cause?.[0]?.description || data?.cause?.[0]?.code || ('HTTP ' + response.status);
      const e = new Error(String(detail));
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
  const payment = await mercadoPago('/v1/payments/' + encodeURIComponent(paymentId));
  const rawStatus = String(payment?.status || '').toLowerCase();
  const status = rawStatus === 'approved' ? 'paid' :
    ['cancelled','canceled'].includes(rawStatus) ? 'cancelled' :
    ['rejected','refunded','charged_back'].includes(rawStatus) ? 'failed' : 'pending';
  await query('update payments set status=$1, provider_payment_id=coalesce($2,provider_payment_id), paid_at=case when $1=\'paid\' then coalesce(paid_at,now()) else paid_at end, updated_at=now() where provider=\'mercado_pago\' and (provider_order_id=$3 or provider_payment_id=$3)',
    [status, String(payment?.id || paymentId), String(paymentId)]);
  return { status, payment };
}

app.post('/webhooks/stripe', express.raw({ type: 'application/json', limit: '2mb' }), async (req, res) => {
  const secret=String(process.env.STRIPE_WEBHOOK_SECRET||'');if(!secret)return errorJson(res,503,'Stripe webhook não configurado.');
  const signature=String(req.headers['stripe-signature']||'');if(!signature)return errorJson(res,400,'Assinatura Stripe ausente.');
  const parts=Object.fromEntries(signature.split(',').map(x=>x.split('='))),timestamp=Number(parts.t),provided=String(parts.v1||'');
  if(!Number.isFinite(timestamp)||!provided||Math.abs(Date.now()/1000-timestamp)>300)return errorJson(res,400,'Assinatura Stripe expirada.');
  const payload=Buffer.isBuffer(req.body)?req.body.toString('utf8'):'';const expected=crypto.createHmac('sha256',secret).update(timestamp+'.'+payload).digest('hex');
  if(expected.length!==provided.length||!crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(provided)))return errorJson(res,400,'Assinatura Stripe inválida.');
  try{
    const event=JSON.parse(payload),eventId=String(event.id||''),object=event.data?.object||{},providerId=String(object.payment_intent||object.id||'');
    if(!eventId||!providerId)return res.json({received:true});
    const tenantId=(await query('select app_tenant_for_payment($1,$2) as tenant_id',['stripe',providerId])).rows[0]?.tenant_id;
    if(!tenantId)return res.json({received:true});
    const userId=(await query('select app_user_for_payment($1,$2) as user_id',['stripe',providerId])).rows[0]?.user_id;
    if(!userId)return res.json({received:true});
    return await runWithTenantContext({tenantId:String(tenantId),userId:String(userId),role:'SYSTEM',requestId:crypto.randomUUID()},async()=>{
      const dedupe=await query("insert into webhook_events(provider,event_id,payload,received_at) values('stripe',$1,$2,now()) on conflict(provider,event_id) do nothing returning id",[eventId,JSON.stringify(event)]);
      if(dedupe.rowCount===0)return res.json({received:true,deduplicated:true});
      const eventType=String(event.type||'');let status=null;
      if(/succeeded|paid|completed/.test(eventType))status='paid';else if(/failed|canceled|cancelled/.test(eventType))status=eventType.includes('cancel')?'cancelled':'failed';
      if(status)await updatePaymentByProvider('stripe',providerId,status,status==='paid'?new Date():null);
      return res.json({received:true});
    });
  }catch{return errorJson(res,400,'Webhook Stripe inválido.');}
});

app.use(cors(buildCorsOptions()));
app.use(express.json({ limit: '8mb', strict: true }));
app.use(buildRateLimiter(redis));
app.use(tenantContextMiddleware(verifyAccess));

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
      const tenant = (await client.query('select app_tenant_for_user($1) as tenant_id',[u.id])).rows[0]?.tenant_id;
      if (!tenant) {
        const t = (await client.query('insert into tenants(name) values($1) returning id',[u.email])).rows[0];
        await client.query('insert into tenant_users(tenant_id,user_id,role) values($1,$2,\'OWNER\')',[t.id,u.id]);
      }
      const resolvedTenant=(await client.query('select app_tenant_for_user($1) as tenant_id',[u.id])).rows[0].tenant_id;
      await client.query('select set_config($1,$2,true)',['app.tenant_id',resolvedTenant]);
      await client.query('select set_config($1,$2,true)',['app.user_id',u.id]);
      await client.query('insert into subscriptions(user_id,plan,status) values($1,$2,$3)', [u.id, 'basic', 'pending']);
      return u;
    });
    const u = result;
    const accessToken = signAccess({ sub: u.id, email: u.email, role: 'CUSTOMER', tenant_id: await tenantIdForUser(u.id) });
    const refreshToken = await issueRefreshToken(u.id, 'CUSTOMER');
    res.status(201).json({ token: accessToken, refreshToken, role: 'CUSTOMER', customer: { id: u.id, email: u.email }, market });
  } catch (e) {
    if (e.code === '23505') return errorJson(res, 409, 'Conta já existente.');
    console.error('[auth/register]', e.message);
    return errorJson(res, 500, 'Não foi possível criar a conta.');
  }
});

async function issueRefreshToken(subject, role) {
  const tenantId=await tenantIdForUser(subject);
  const token = signRefresh({ sub: subject, role, tenant_id: tenantId });
  await runWithTenantContext({tenantId,userId:String(subject),role:String(role),requestId:crypto.randomUUID()},async()=>query('insert into refresh_tokens(user_id,tenant_id,token_hash,expires_at) values($1,$2,$3,now()+($4::text || \' days\')::interval)', [subject,tenantId,hashToken(token),REFRESH_TTL_DAYS]));
  return token;
}

app.post('/auth/login', async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (!limitLogin('login:' + ip)) return errorJson(res, 429, 'Muitas tentativas. Aguarde um momento.');
  const login = String(req.body?.login || req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (OWNER_LOGIN && login === OWNER_LOGIN.toLowerCase() && OWNER_PASSWORD && password === OWNER_PASSWORD) {
    const ownerId = await ensureOwnerIdentity();
    await ensureTenantForUser(ownerId, 'VÉRTICE Owner');
    const token = signAccess({ sub: ownerId, email: OWNER_LOGIN, role: 'OWNER', tenant_id: await tenantIdForUser(ownerId) });
    return res.json({ token, refreshToken: await issueRefreshToken(ownerId, 'OWNER'), role: 'OWNER', customer: { id: ownerId, email: OWNER_LOGIN } });
  }
  try {
    const r = await query('select id,email,password_hash,country_code,locale from users where email=$1', [login]);
    const c = r.rows[0];
    if (!c || !(await bcrypt.compare(password, c.password_hash))) return errorJson(res, 401, 'Login ou senha inválidos.');
    const token = signAccess({ sub: c.id, email: c.email, role: 'CUSTOMER', tenant_id: await tenantIdForUser(c.id) });
    const refreshToken = await issueRefreshToken(c.id, 'CUSTOMER');
    res.json({ token, refreshToken, role: 'CUSTOMER', customer: { id: c.id, email: c.email }, market: marketMap.get(c.country_code) || marketMap.get('BR') });
  } catch (e) { console.error('[auth/login]', e.message); return errorJson(res, 500, 'Falha de autenticação.'); }
});

app.post('/auth/refresh', async (req, res) => {
  const token=String(req.body?.refreshToken||''); if(!token)return errorJson(res,400,'refreshToken é obrigatório.');
  try{
    const payload=verifyRefresh(token);
    if(payload.type!=='refresh'||typeof payload.tenant_id!=='string')throw new Error('invalid');
    return await runWithTenantContext({tenantId:String(payload.tenant_id),userId:String(payload.sub),role:String(payload.role||'CUSTOMER'),requestId:crypto.randomUUID()},async()=>{
      const found=await query('select id,user_id,tenant_id,revoked_at,expires_at from refresh_tokens where token_hash=$1',[hashToken(token)]);
      if(!found.rows[0])return errorJson(res,401,'Refresh token inválido ou inexistente.');
      if(found.rows[0].revoked_at){await query('update refresh_tokens set revoked_at=coalesce(revoked_at,now()) where user_id=$1 and tenant_id=$2 and revoked_at is null',[found.rows[0].user_id,found.rows[0].tenant_id]);return errorJson(res,401,'Reuse de refresh token detectado. Sessões revogadas.','REFRESH_REUSE_DETECTED');}
      if(new Date(found.rows[0].expires_at).getTime()<=Date.now())return errorJson(res,401,'Refresh token expirado.');
      await query('update refresh_tokens set revoked_at=now() where id=$1',[found.rows[0].id]);
      const u=(await query('select id,email from users where id=$1',[payload.sub])).rows[0]; if(!u)return errorJson(res,401,'Usuário não encontrado.');
      const newRefresh=await issueRefreshToken(u.id,payload.role||'CUSTOMER');
      return res.json({token:signAccess({sub:u.id,email:u.email,role:payload.role||'CUSTOMER',tenant_id:payload.tenant_id}),refreshToken:newRefresh,role:payload.role||'CUSTOMER'});
    });
  }catch{return errorJson(res,401,'Refresh token inválido ou expirado.');}
});

app.get('/me', auth, async (req, res) => {
  if (req.user.role === 'OWNER') return res.json({ role: 'OWNER', customer: { id: req.user.sub, email: req.user.email }, subscription: { plan: 'owner', status: 'active', currentPeriodEnd: null } });
  const u = (await query('select id,email,country_code,locale from users where id=$1', [req.user.sub])).rows[0];
  if (!u) return errorJson(res, 404, 'Usuário não encontrado.');
  const s = await currentSubscription(u.id);
  res.json({ role: 'CUSTOMER', customer: { id: u.id, email: u.email }, market: marketMap.get(u.country_code) || marketMap.get('BR'), subscription: s ? { plan: s.plan, status: s.status, currentPeriodEnd: s.current_period_end } : null });
});

app.post('/devices/register', auth, async (req, res) => {
  const id=String(req.body?.deviceId||'').trim(),mode=String(req.body?.mode||'').trim(),name=String(req.body?.deviceName||'').trim().slice(0,100);
  if(!id||!['comando','operacao','monitoramento'].includes(mode))return errorJson(res,400,'deviceId e mode são obrigatórios.');
  try{const result=await registerDeviceNow({tenantId:req.user.tenant_id,userId:req.user.sub,deviceId:id,mode,deviceName:name,allowRebind:req.user.role==='OWNER'});return res.status(200).json({ok:true,...result});}catch{return errorJson(res,403,'Registro de dispositivo rejeitado.','POLICY_DENIED');}
});
app.post('/owner/devices/register', auth, ownerOnly, async (req, res) => {
  const id=String(req.body?.deviceId||'').trim(),mode=String(req.body?.mode||'').trim(),name=String(req.body?.deviceName||'').trim().slice(0,100);
  if(!id||!['comando','operacao','monitoramento'].includes(mode))return errorJson(res,400,'deviceId e mode são obrigatórios.');
  try {
    const result=await registerDeviceNow({
      tenantId:req.user.tenant_id,
      userId:req.user.sub,
      deviceId:id,
      mode,
      deviceName:name
    });
    return res.status(200).json({ok:true,...result});
  } catch(e) {
    console.error('[owner/device-register]', e.message);
    return errorJson(res,403,'Registro de dispositivo rejeitado.','POLICY_DENIED');
  }
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
  const d=(await query('select user_id,mode from devices where id=$1 and tenant_id=$2',[deviceId,req.user.tenant_id])).rows[0];
  if(!d||d.user_id!==req.user.sub)return errorJson(res,403,'Dispositivo não pertence à conta.');
  if(mode==='operacao'&&d.mode!=='operacao')return errorJson(res,409,'O dispositivo não está em OPERAÇÃO.');
  const commandId=crypto.randomUUID();
  try{const result=await enqueueExecution({actionId:crypto.randomUUID(),tenantId:String(req.user.tenant_id),actorUserId:String(req.user.sub),type:'command',resource:'command',operation:'create',payload:{action:'create_command',commandId,command,mode,deviceId,userId:String(req.user.sub),actorRole:String(req.user.role)},idempotencyKey:String(req.headers['idempotency-key']||crypto.randomUUID())});return res.status(202).json({id:commandId,status:result.status,executionId:result.actionId,message:result.status==='awaiting_mfa'?'Aguardando MFA.':'Comando recebido pelo VÉRTICE.'});}catch{return errorJson(res,403,'Comando rejeitado pelo Policy Engine.','POLICY_DENIED');}
});
app.post('/owner/commands', auth, ownerOnly, async (req,res) => {
  if (!(await activeSubscription(req.user.sub))) return errorJson(res,402,'Assinatura não está ativa.');
  const command=String(req.body?.command||'').trim(), mode=String(req.body?.mode||''), deviceId=String(req.body?.deviceId||'').trim();
  if(!command||command.length>2000||!['comando','operacao','monitoramento'].includes(mode)||!deviceId)return errorJson(res,400,'Comando, modo ou deviceId inválido.');
  try {
    const d=(await query('select user_id,mode,tenant_id from devices where id=$1',[deviceId])).rows[0];
    if(!d)return errorJson(res,403,'Dispositivo não está registrado para o OWNER.','DEVICE_NOT_REGISTERED');
    if(String(d.tenant_id)!==String(req.user.tenant_id))return errorJson(res,403,'Dispositivo pertence a outro tenant.','DEVICE_CROSS_TENANT');
    if(String(d.user_id)!==String(req.user.sub) || String(d.mode)!==mode) {
      await query('update devices set user_id=$1,mode=$2,last_seen_at=now() where id=$3',[String(req.user.sub),mode,deviceId]);
    }
    const commandId=crypto.randomUUID();
    const result=await enqueueExecution({
      actionId:crypto.randomUUID(),
      tenantId:String(req.user.tenant_id),
      actorUserId:String(req.user.sub),
      type:'command',
      resource:'command',
      operation:'create',
      payload:{action:'create_command',commandId,command,mode,deviceId,userId:String(req.user.sub),actorRole:'OWNER'},
      idempotencyKey:String(req.headers['idempotency-key']||crypto.randomUUID())
    });
    return res.status(202).json({id:commandId,status:result.status,executionId:result.actionId,message:'Comando recebido pelo VÉRTICE.'});
  } catch(e) {
    return errorJson(res,403,'Comando rejeitado pelo Policy Engine.','POLICY_DENIED');
  }
});

app.get('/security/emergency-stop',auth,async(req,res)=>res.json({stopped:await tenantEmergencyStopped(req.user.tenant_id)}));
app.post('/security/emergency-stop',auth,async(req,res)=>{
  const stopped=req.body?.stopped===true;
  await query('update tenants set emergency_stop=$1,updated_at=now() where id=$2',[stopped,req.user.tenant_id]);
  res.json({ok:true,stopped});
});

app.get('/commands',auth,async(req,res)=>{const cid=userId(req);if(!cid)return res.json({commands:[]});const rows=(await query('select id,device_id as "deviceId",mode,command,status,created_at as "createdAt" from commands where user_id=$1 order by created_at desc limit 50',[cid])).rows;res.json({commands:rows});});
app.get('/commands/next',auth,async(req,res)=>{
  if(!(await activeSubscription(req.user.sub))) return errorJson(res,402,'Assinatura não está ativa.');
  const deviceId=String(req.query?.deviceId||'').trim();
  if(await tenantEmergencyStopped(req.user.tenant_id)) return res.json({ok:true,command:null,blocked:true});
  try{
    const command=await withTransaction(async client=>{
      const d=(await client.query('select id,user_id,mode from devices where id=$1 and tenant_id=$2 for update',[deviceId,req.user.tenant_id])).rows[0];
      if(!d||String(d.user_id)!==String(req.user.sub)||d.mode!=='operacao') throw Object.assign(new Error('DEVICE_NOT_OWNED'),{status:403});
      const row=(await client.query(
        "update commands set status='dispatched',updated_at=now() where id=(select id from commands where user_id=$1 and tenant_id=$3 and device_id=$2 and mode='operacao' and status='queued' order by created_at asc for update skip locked limit 1) returning id,command,mode,status",
        [req.user.sub,deviceId,req.user.tenant_id]
      )).rows[0]||null;
      if(row) await client.query("insert into command_events(tenant_id,user_id,command_id,status) values($1,$2,$3,'dispatched')",[req.user.tenant_id,req.user.sub,row.id]);
      return row;
    });
    return res.json({ok:true,command});
  }catch(e){
    return errorJson(res,e.status||500,e.status===403?'Terminal OPERAÇÃO não autorizado.':'Não foi possível reservar o comando.');
  }
});
app.post('/commands/:commandId/status',auth,async(req,res)=>{
  if(!(await activeSubscription(req.user.sub))) return errorJson(res,402,'Assinatura não está ativa.');
  const id=String(req.params.commandId),next=String(req.body?.status||'').toLowerCase(),deviceId=String(req.body?.deviceId||'').trim();
  if(!['executing','succeeded','failed','cancelled'].includes(next)||!deviceId) return errorJson(res,400,'Status ou deviceId inválido.');
  try{
    const status=await withTransaction(async client=>{
      const row=(await client.query('select status from commands where id=$1 and user_id=$2 and tenant_id=$3 and device_id=$4 for update',[id,req.user.sub,req.user.tenant_id,deviceId])).rows[0];
      if(!row) throw Object.assign(new Error('TENANT_ISOLATION'),{status:403});
      const current=String(row.status);
      const valid=(next==='executing'&&current==='dispatched')||(['succeeded','failed','cancelled'].includes(next)&&['dispatched','executing'].includes(current));
      if(!valid) throw Object.assign(new Error('INVALID_COMMAND_TRANSITION'),{status:409});
      await client.query('update commands set status=$1,updated_at=now() where id=$2',[next,id]);
      await client.query('insert into command_events(tenant_id,user_id,command_id,status) values($1,$2,$3,$4)',[req.user.tenant_id,req.user.sub,id,next]);
      return next;
    });
    return res.json({ok:true,id,status});
  }catch(e){
    return errorJson(res,e.status||500,e.status===403?'Comando não pertence ao tenant/usuário.':e.status===409?'Transição de comando inválida.':'Falha ao atualizar comando.',e.status===403?'TENANT_ISOLATION':e.status===409?'INVALID_COMMAND_TRANSITION':undefined);
  }
});

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
  const currencyCode=String(market.currencyCode||market.currency||'BRL').toUpperCase();
  try{
    const hash=await bcrypt.hash(password,12);
    const u=await withTransaction(async client=>{
      let found=(await client.query('select id,password_hash from users where email=$1',[email])).rows[0];
      if(found){if(!(await bcrypt.compare(password,found.password_hash)))throw Object.assign(new Error('Conta existente.'),{status:409});}
      else found=(await client.query('insert into users(email,password_hash,country_code,locale) values($1,$2,$3,$4) returning id,password_hash',[email,hash,market.countryCode,market.locale])).rows[0];
      const tenant=(await client.query('select app_tenant_for_user($1) as tenant_id',[found.id])).rows[0]?.tenant_id;
      if(!tenant){
        const t=(await client.query('insert into tenants(name) values($1) returning id',[email])).rows[0];
        await client.query('insert into tenant_users(tenant_id,user_id,role) values($1,$2,\'OWNER\')',[t.id,found.id]);
      }
      const resolvedTenant=(await client.query('select app_tenant_for_user($1) as tenant_id',[found.id])).rows[0].tenant_id;
      await client.query('select set_config($1,$2,true)',['app.tenant_id',resolvedTenant]);
      await client.query('select set_config($1,$2,true)',['app.user_id',found.id]);
      const s=(await client.query('select id,status from subscriptions where user_id=$1 order by updated_at desc limit 1',[found.id])).rows[0];
      if(s)await client.query('update subscriptions set plan=$1,status=\'pending\',current_period_start=null,current_period_end=null,updated_at=now() where id=$2',[selected.id,s.id]);
      else await client.query('insert into subscriptions(user_id,plan,status) values($1,$2,\'pending\')',[found.id,selected.id]);
      return found;
    });
    const tenantId=await tenantIdForUser(u.id);
    return await runWithTenantContext({tenantId,userId:String(u.id),role:'CUSTOMER',requestId:crypto.randomUUID()},async()=>{
    const payment=(await query('insert into payments(user_id,provider,external_reference,amount,currency_code,status) values($1,$2,$3,$4,$5,\'pending\') returning id',[u.id,market.countryCode==='BR'||market.countryCode==='MX'?'mercado_pago':'stripe',null,amount,currencyCode])).rows[0];
    const ref=externalReference(u.id,payment.id);
    await query('update payments set external_reference=$1 where id=$2',[ref,payment.id]);
    if(market.countryCode==='BR'||market.countryCode==='MX'){
      const preference=await mercadoPago('/checkout/preferences',{method:'POST',headers:{'X-Idempotency-Key':String(payment.id)},body:JSON.stringify({
        items:[{id:String(selected.id),title:'VÉRTICE — '+selected.name,description:selected.description,quantity:1,currency_id:currencyCode,unit_price:amount}],
        payer:{email},
        external_reference:ref,
        back_urls:{
          success:String(process.env.PUBLIC_APP_SUCCESS_URL||'https://vertice-backend-8gj5.onrender.com/payment/success'),
          pending:String(process.env.PUBLIC_APP_PENDING_URL||process.env.PUBLIC_APP_SUCCESS_URL||'https://vertice-backend-8gj5.onrender.com/payment/pending'),
          failure:String(process.env.PUBLIC_APP_CANCEL_URL||'https://vertice-backend-8gj5.onrender.com/payment/cancel')
        },
        auto_return:'approved',
        notification_url:String(process.env.MERCADOPAGO_WEBHOOK_URL||'https://vertice-backend-8gj5.onrender.com/webhooks/mercadopago')
      })});
      const preferenceId=String(preference.id||''),checkoutUrl=String(preference.init_point||preference.sandbox_init_point||'');
      if(!preferenceId||!checkoutUrl)throw new Error('Mercado Pago não retornou a URL de checkout.');
      await query('update payments set provider_order_id=$1,checkout_url=$2 where id=$3',[preferenceId,checkoutUrl,payment.id]);
      return res.status(201).json({paymentId:payment.id,provider:'mercado_pago',plan:selected.id,amount,currency:currencyCode,checkoutUrl,statusToken:issuePaymentCapability(String(payment.id),String(u.id),String(tenantId))});
    }
    const params=stripeForm({'mode':'payment','success_url':String(process.env.PUBLIC_APP_SUCCESS_URL||'https://vertice-backend-8gj5.onrender.com/payment/success'),'cancel_url':String(process.env.PUBLIC_APP_CANCEL_URL||'https://vertice-backend-8gj5.onrender.com/payment/cancel'),'line_items[0][price_data][currency]':currencyCode.toLowerCase(),'line_items[0][price_data][product_data][name]':'VÉRTICE — '+selected.name,'line_items[0][price_data][unit_amount]':String(Math.round(amount*100)),'line_items[0][quantity]':'1','metadata[payment_id]':String(payment.id),'metadata[external_reference]':ref});
    const session=await stripe('/v1/checkout/sessions',{method:'POST',body:params});
    await query('update payments set provider_order_id=$1,checkout_url=$2 where id=$3',[String(session.id),String(session.url||''),payment.id]);
    return res.status(201).json({paymentId:payment.id,provider:'stripe',plan:selected.id,amount,currency:currencyCode,checkoutUrl:session.url,statusToken:issuePaymentCapability(String(payment.id),String(u.id),String(tenantId))});
    });
  }catch(e){safeLog('[checkout]',safeError(e));return errorJson(res,e.status&&e.status<500?e.status:502,'Falha ao iniciar cobrança.');}
});

app.get('/public/payment/status',async(req,res)=>{const capability=String(req.query?.token||'').trim();if(!capability)return errorJson(res,400,'Token de pagamento obrigatório.','PAYMENT_CAPABILITY_REQUIRED');let cap;try{cap=verifyPaymentCapability(capability);}catch{return errorJson(res,401,'Token de pagamento inválido ou expirado.','PAYMENT_CAPABILITY_INVALID');}return await runWithTenantContext({tenantId:cap.tenantId,userId:cap.userId,role:'CUSTOMER',requestId:crypto.randomUUID()},async()=>{const p=(await query('select id,user_id,tenant_id,provider,external_reference from payments where id=$1',[cap.paymentId])).rows[0];if(!p||String(p.user_id)!==cap.userId||String(p.tenant_id)!==cap.tenantId)return errorJson(res,404,'Pagamento não encontrado.');try{if(p.provider==='mercado_pago'&&p.external_reference){const found=await mercadoPago('/v1/payments/search?external_reference='+encodeURIComponent(p.external_reference));const mpPayment=Array.isArray(found?.results)?found.results.sort((a,b)=>new Date(b?.date_created||0)-new Date(a?.date_created||0))[0]:null;if(mpPayment?.id)await syncMercadoPagoPayment(String(mpPayment.id));}const fresh=(await query('select status,currency_code,amount,checkout_url from payments where id=$1',[cap.paymentId])).rows[0];res.json({paymentId:cap.paymentId,...fresh});}catch(e){return errorJson(res,502,'Falha ao verificar pagamento.');}});});

app.post('/webhooks/mercadopago',async(req,res)=>{if(!validMercadoPagoWebhook(req))return errorJson(res,401,'Webhook Mercado Pago inválido.');const id=String(req.query['data.id']||req.body?.data?.id||'');if(!id)return res.json({received:true});try{const tenantId=(await query('select app_tenant_for_payment($1,$2) as tenant_id',['mercado_pago',id])).rows[0]?.tenant_id;if(!tenantId)return res.json({received:true});const uid=(await query('select app_user_for_payment($1,$2) as user_id',['mercado_pago',id])).rows[0]?.user_id;if(!uid)return res.json({received:true});return await runWithTenantContext({tenantId:String(tenantId),userId:String(uid),role:'SYSTEM',requestId:crypto.randomUUID()},async()=>{const eventId=String(req.headers['x-request-id']||'')+':'+id;const dedupe=await query("insert into webhook_events(provider,event_id,payload,received_at) values('mercado_pago',$1,$2,now()) on conflict(provider,event_id) do nothing returning id",[eventId,JSON.stringify(req.body||{})]);if(dedupe.rowCount===0)return res.json({received:true,deduplicated:true});await syncMercadoPagoPayment(id);return res.json({received:true});});}catch(e){return errorJson(res,502,'Falha ao sincronizar Mercado Pago.');}});

app.get('/sales',auth,async(req,res)=>{const m=month(req.query?.month);if(!m)return errorJson(res,400,'Mês inválido.');const rows=(await query('select id,amount,currency_code as currency,provider,status,checkout_url as "checkoutUrl",paid_at as "paidAt",created_at as "createdAt" from payments where user_id=$1 and to_char(created_at,\'YYYY-MM\')=$2 order by created_at desc limit 100',[req.user.sub,m])).rows;res.json({month:m,sales:rows});});
app.post('/sales/orders',auth,async(req,res)=>{const product=String(req.body?.product||'').trim().slice(0,120),amount=money(req.body?.amount),market=normalizeMarket(req.body?.countryCode||'BR',req.body?.locale,req.body?.currencyCode);if(!product||!Number.isFinite(amount)||amount<=0||!market)return errorJson(res,400,'Produto, valor ou mercado inválido.');req.body={...req.body,plan:product};return res.redirect(307,'/public/signup/checkout');});

app.post('/ai/agent/chat', auth, async (req,res) => {
  if (req.user.role !== 'OWNER' && !(await activeSubscription(req.user.sub))) return errorJson(res,402,'Assinatura não está ativa.');
  const message=String(req.body?.message||'').trim().slice(0,6000);
  const mode=String(req.body?.mode||'').trim();
  if(!message||!['comando','operacao','monitoramento'].includes(mode)) return errorJson(res,400,'Mensagem ou modo inválido.');

  const key=String(process.env.VERTICE_AI_API_KEY||process.env.GROQ_API_KEY||process.env.OPENAI_API_KEY||'');
  const base=String(process.env.VERTICE_AI_BASE_URL||(process.env.GROQ_API_KEY?'https://api.groq.com/openai/v1':process.env.OPENAI_API_KEY?'https://api.openai.com/v1':'')).replace(/\/$/,'');
  const systemInstruction='Retorne somente uma proposta JSON. A IA interpreta a intenção, mas não autoriza nem executa. Formato: {"command":"comando normalizado","reason":"ação pretendida","intent":"execute"}. Não invente credenciais ou segredos.';
  let proposal={command:message.slice(0,2000),reason:'Intenção recebida pelo VÉRTICE.',intent:'execute'};

  if(key&&base){
    try{
      const data=await providerFetch(base,'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify({model:process.env.VERTICE_AI_MODEL||(process.env.GROQ_API_KEY?'llama-3.3-70b-versatile':'gpt-4o-mini'),temperature:0,messages:[{role:'system',content:systemInstruction},{role:'user',content:message}],response_format:{type:'json_object'}})},20000);
      const raw=String(data?.choices?.[0]?.message?.content||'');
      const parsed=JSON.parse(raw);
      if(parsed&&typeof parsed==='object') proposal={command:String(parsed.command||message).slice(0,2000),reason:String(parsed.reason||'Intenção recebida pelo VÉRTICE.').slice(0,1000),intent:'execute'};
    }catch(e){console.error('[ai/proposal]',e.message);}
  }

  const proposalId=crypto.randomUUID();
  await query('insert into ai_proposals(id,tenant_id,user_id,mode,command,reason,intent) values($1,$2,$3,$4,$5,$6,$7)',[proposalId,req.user.tenant_id,req.user.sub,mode,proposal.command,proposal.reason,proposal.intent]);
  if(req.user.role!=='OWNER') await query('insert into ai_conversations(user_id,tenant_id,mode,role,content) values($1,$2,$3,\'user\',$4),($1,$2,$3,\'assistant\',$5)',[req.user.sub,req.user.tenant_id,mode,message,JSON.stringify({...proposal,proposalId})]);
  return res.json({ok:true,proposalId,...proposal,execution:{status:'not_requested'},mode});
});

app.post('/ai/agent/execute',auth,async(req,res)=>{
  if(req.user.role!=='OWNER'&&!(await activeSubscription(req.user.sub))) return errorJson(res,402,'Assinatura não está ativa.');
  const mode=String(req.body?.mode||'').trim(),deviceId=String(req.body?.deviceId||'').trim(),command=String(req.body?.command||'').trim().slice(0,2000),proposalId=String(req.body?.proposalId||'').trim();
  if(mode!=='operacao'||!deviceId||!command||!/^\w{8}-\w{4}-\w{4}-\w{4}-\w{12}$/.test(proposalId)) return errorJson(res,400,'Proposta ou dispositivo inválido.');
  if(await tenantEmergencyStopped(req.user.tenant_id)) return errorJson(res,409,'EMERGENCY_STOP ativo.','EMERGENCY_STOP');
  try{
    const tenantId=String(req.user.tenant_id),actorUserId=String(req.user.sub);
    if(req.user.role==='OWNER') await registerDeviceNow({tenantId,userId:actorUserId,deviceId,mode,deviceName:String(req.body?.deviceName||'Android • OPERAÇÃO').slice(0,100),allowRebind:true});
    else{
      const d=(await query('select user_id,mode from devices where id=$1 and tenant_id=$2',[deviceId,tenantId])).rows[0];
      if(!d||String(d.user_id)!==actorUserId) return errorJson(res,403,'Dispositivo não pertence à conta.','DEVICE_NOT_OWNED');
      if(String(d.mode)!=='operacao') return errorJson(res,409,'O dispositivo não está em OPERAÇÃO.','DEVICE_MODE_MISMATCH');
    }
    const commandId=crypto.randomUUID();
    const result=await enqueueExecution({actionId:crypto.randomUUID(),tenantId,actorUserId,type:'command',resource:'command',operation:'create',payload:{action:'create_command',commandId,command,mode:'operacao',deviceId,userId:actorUserId,actorRole:String(req.user.role),proposalId},idempotencyKey:'ai-command-'+commandId});
    return res.status(202).json({ok:true,proposalId,commandId,executionId:result.actionId,status:result.status});
  }catch(e){
    console.error('[ai/execute]',e.message);
    const code=String(e.message||'');
    if(code==='EMERGENCY_STOP') return errorJson(res,409,'EMERGENCY_STOP ativo.','EMERGENCY_STOP');
    if(code==='DEVICE_NOT_OWNED') return errorJson(res,403,'Dispositivo não pertence à conta.','DEVICE_NOT_OWNED');
    if(code==='PROPOSAL_INVALID') return errorJson(res,409,'Proposta inválida, expirada ou já executada.','PROPOSAL_INVALID');
    return errorJson(res,409,'Proposta rejeitada pelo Policy Engine.','POLICY_DENIED');
  }
});

app.get('/ai/agent/history',auth,async(req,res)=>{if(req.user.role==='OWNER')return res.json({ok:true,history:[]});const rows=(await query('select role,content,mode,created_at as "createdAt" from ai_conversations where user_id=$1 order by created_at desc limit 100',[req.user.sub])).rows.reverse();res.json({ok:true,history:rows});});

app.get('/admin/overview',auth,ownerOnly,async(req,res)=>{const [customers,subs,devices,commands,sales]=await Promise.all([query('select count(*)::int n from users'),query("select count(*)::int n from subscriptions where status='active'"),query('select count(*)::int n from devices'),query("select count(*)::int n from commands where created_at>=current_date"),query("select coalesce(sum(amount),0) n from payments where status='paid' and to_char(created_at,'YYYY-MM')=to_char(current_date,'YYYY-MM')")]);res.json({customers:customers.rows[0].n,activeSubscriptions:subs.rows[0].n,devices:devices.rows[0].n,commandsToday:commands.rows[0].n,salesMonth:Number(sales.rows[0].n||0)});});

app.post('/api/v1/execution',auth,async(req,res)=>{try{const body=req.body||{};const intent={actionId:crypto.randomUUID(),tenantId:String(req.user.tenant_id||''),actorUserId:String(req.user.sub),type:String(body.type||''),resource:String(body.resource||''),operation:body.operation,payload:body.payload&&typeof body.payload==='object'?body.payload:{},idempotencyKey:String(req.headers['idempotency-key']||body.idempotencyKey||'')};if(!intent.tenantId||intent.idempotencyKey.length<16)return errorJson(res,400,'tenant_id e Idempotency-Key são obrigatórios.');const result=await enqueueExecution(intent);return res.status(result.status==='awaiting_mfa'?202:202).json({ok:true,...result});}catch(e){return errorJson(res,403,'Operação rejeitada pelo Policy Engine.','POLICY_DENIED');}});
app.post('/api/v1/execution/:actionId/approve',auth,async(req,res)=>{if(!['OWNER','ADMIN'].includes(String(req.user.role)))return errorJson(res,403,'Aprovação administrativa necessária.');const id=String(req.params.actionId);try{const result=await withTransaction(async client=>{const task=(await client.query("select id,status,payload from tasks where id=$1 and tenant_id=$2 for update",[id,req.user.tenant_id])).rows[0];if(!task||task.status!=='awaiting_approval')throw new Error('TASK_NOT_AWAITING_APPROVAL');await client.query("update tasks set status='queued',approved_at=now(),updated_at=now() where id=$1 and tenant_id=$2",[id,req.user.tenant_id]);
      const commandId=(await client.query("select (payload->>'commandId')::uuid as id from tasks where id=$1 and tenant_id=$2",[id,req.user.tenant_id])).rows[0]?.id;
      if(commandId){await client.query("update commands set status='queued',updated_at=now() where id=$1 and tenant_id=$2 and status='authorized'",[commandId,req.user.tenant_id]);await client.query("insert into command_events(tenant_id,user_id,command_id,status,metadata) values($1,$2,$3,'queued',$4)",[req.user.tenant_id,req.user.sub,commandId,JSON.stringify({source:'approval'})]);}await client.query("insert into outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload,status,created_at) values($1,'task',$2,'execution.requested',$3,'pending',now()) on conflict do nothing",[req.user.tenant_id,id,JSON.stringify(task.payload)]);return {id,status:'queued'};});return res.json({ok:true,...result});}catch(e){return errorJson(res,409,'Ação não está aguardando aprovação.');}});
app.post('/api/v1/mfa/enroll',auth,async(req,res)=>{if(req.user.role!=='OWNER'&&!(await activeSubscription(req.user.sub)))return errorJson(res,402,'Assinatura não está ativa.');try{return res.json({ok:true,...await enrollMfa(String(req.user.sub),String(req.user.tenant_id))});}catch{return errorJson(res,500,'Não foi possível preparar MFA.');}});
app.post('/api/v1/mfa/verify',auth,async(req,res)=>{const code=String(req.body?.code||'');const taskId=String(req.body?.taskId||'');if(!/^\\d{6}$/.test(code))return errorJson(res,400,'Código MFA inválido.');try{const ok=taskId?await verifyEnabledMfa(String(req.user.sub),String(req.user.tenant_id),code):await enableMfa(String(req.user.sub),String(req.user.tenant_id),code);if(!ok)return errorJson(res,401,'Código MFA inválido.');if(taskId){const task=(await query('select id,status from tasks where id=$1 and tenant_id=$2 and user_id=$3',[taskId,req.user.tenant_id,req.user.sub])).rows[0];if(!task)return errorJson(res,404,'Tarefa não encontrada.');await query("update tasks set status='queued',mfa_verified_at=now(),updated_at=now() where id=$1 and tenant_id=$2 and status='awaiting_mfa'",[taskId,req.user.tenant_id]);
    const commandId=(await query("select (payload->>'commandId')::uuid as id from tasks where id=$1 and tenant_id=$2",[taskId,req.user.tenant_id])).rows[0]?.id;
    if(commandId){await query("update commands set status='queued',updated_at=now() where id=$1 and tenant_id=$2 and status='authorized'",[commandId,req.user.tenant_id]);await query("insert into command_events(tenant_id,user_id,command_id,status,metadata) values($1,$2,$3,'queued',$4)",[req.user.tenant_id,req.user.sub,commandId,JSON.stringify({source:'mfa'})]);}await query("insert into outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload,status,created_at) select $1,'task',$2,'execution.requested',payload,'pending',now() from tasks where id=$2 and tenant_id=$1 on conflict do nothing",[req.user.tenant_id,taskId]);}return res.json({ok:true,verified:true,taskId:taskId||undefined});}catch{return errorJson(res,500,'Não foi possível validar MFA.');}});
app.use((err,req,res,next)=>{safeLog('[vertice]',safeError(err));if(res.headersSent)return next(err);return errorJson(res,500,'Erro interno do servidor.');});

async function start() {
  await waitForDatabase();

  let embeddedWorker = null;
  let outboxTimer = null;

  if (NODE_ENV === 'production' && process.env.VERTICE_EMBED_WORKER !== 'false') {
    const workerModule = await import('./queue/executionWorker.ts');
    const outboxModule = await import('./outbox/publisher.ts');
    embeddedWorker = workerModule.executionWorker;
    outboxTimer = setInterval(() => {
      outboxModule.publishPendingOutbox(100).catch(error =>
        console.error('[vertice-outbox]', error instanceof Error ? error.message : 'publish failed')
      );
    }, 1000);
    console.log('[vertice] embedded execution worker started');
  }

  const server=app.listen(PORT,()=>console.log('VÉRTICE backend ouvindo na porta '+PORT));
  const shutdown=async(signal)=>{
    console.log('[vertice] '+signal);
    if (outboxTimer) clearInterval(outboxTimer);
    try { if (embeddedWorker) await embeddedWorker.close(); }
    finally {
      server.close(async()=>{try{await closeDatabase();}finally{process.exit(0);}});
    }
  };
  process.once('SIGTERM',()=>shutdown('SIGTERM'));process.once('SIGINT',()=>shutdown('SIGINT'));
}
start().catch(err=>{console.error('[vertice] startup failed:',err.message);process.exit(1);});
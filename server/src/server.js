const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const { v4: uuid } = require('uuid');
const crypto = require('crypto');
require('./vertice-preload');
const { VERTICE_MARKETS } = require('./markets');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
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
CREATE TABLE IF NOT EXISTS sales(id TEXT PRIMARY KEY,customer_id TEXT NOT NULL,amount REAL NOT NULL,product TEXT,channel TEXT,status TEXT NOT NULL DEFAULT 'pending',mp_order_id TEXT,mp_payment_id TEXT,checkout_url TEXT,paid_at TEXT,created_at TEXT NOT NULL,external_reference TEXT);
CREATE TABLE IF NOT EXISTS payment_orders(id TEXT PRIMARY KEY,sale_id TEXT NOT NULL,customer_id TEXT NOT NULL,provider TEXT NOT NULL,provider_order_id TEXT,provider_payment_id TEXT,status TEXT NOT NULL,amount REAL NOT NULL,checkout_url TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
`);
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_external_reference ON sales(external_reference) WHERE external_reference IS NOT NULL');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_mp_order_id ON sales(mp_order_id) WHERE mp_order_id IS NOT NULL');
db.exec('CREATE INDEX IF NOT EXISTS idx_sales_customer_created ON sales(customer_id,created_at)');
db.exec('CREATE INDEX IF NOT EXISTS idx_commands_customer_created ON commands(customer_id,created_at)');
db.exec('CREATE INDEX IF NOT EXISTS idx_devices_customer ON devices(customer_id)');

const secret = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? (() => { throw new Error('JWT_SECRET é obrigatório em produção.'); })() : crypto.randomBytes(32).toString('hex'));
const OWNER_LOGIN = process.env.OWNER_LOGIN || 'admchefe';
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || 'coringa';
const PORT = Number(process.env.PORT || 8080);
const LOGIN_LIMITS = new Map();

function tokenFor(id,email,role){ return jwt.sign({sub:id,email,role},secret,{expiresIn:'30d'}); }
function auth(req,res,next){ try { const h=String(req.headers.authorization||''); if(!h.startsWith('Bearer ')) return res.status(401).json({error:'Não autenticado'}); req.user=jwt.verify(h.slice(7),secret); next(); } catch { return res.status(401).json({error:'Sessão inválida'}); } }
function ownerOnly(req,res,next){ if(req.user.role!=='OWNER') return res.status(403).json({error:'Acesso de proprietário necessário.'}); next(); }
function money(v){ const n=Number(v); return Number.isFinite(n)?Number(n.toFixed(2)):NaN; }
function month(v){ const m=String(v||new Date().toISOString().slice(0,7)); return /^\d{4}-(0[1-9]|1[0-2])$/.test(m)?m:null; }
function sub(id){ return db.prepare('SELECT * FROM subscriptions WHERE customer_id=? ORDER BY updated_at DESC LIMIT 1').get(id)||null; }
function activeSub(id){ const s=sub(id); return Boolean(s&&s.status==='active'&&(!s.current_period_end||new Date(s.current_period_end)>=new Date())); }
function customerId(req){ return req.user.role==='OWNER'?'owner':req.user.sub; }
function limitLogin(key){ const now=Date.now(); const x=LOGIN_LIMITS.get(key); if(!x||now-x.t>=60000){LOGIN_LIMITS.set(key,{t:now,n:1});return true;} x.n+=1; return x.n<=10; }
function parseSig(h){ const out={}; String(h||'').split(',').forEach(p=>{const [k,...r]=p.split('=');if(k&&r.length)out[k.trim()]=r.join('=').trim();});return out; }
function validMpWebhook(req){
  const secretHook=process.env.MERCADOPAGO_WEBHOOK_SECRET; if(!secretHook)return false;
  const sig=parseSig(req.headers['x-signature']); const requestId=String(req.headers['x-request-id']||''); const dataId=String(req.query['data.id']||req.body?.data?.id||''); const ts=String(sig.ts||''); const v1=String(sig.v1||'');
  if(!requestId||!dataId||!ts||!v1)return false; const tsMs=Number(ts)*1000; if(!Number.isFinite(tsMs)||Math.abs(Date.now()-tsMs)>600000)return false;
  const manifest=`id:${dataId};request-id:${requestId};ts:${ts};`; const expected=crypto.createHmac('sha256',secretHook).update(manifest).digest('hex'); const a=Buffer.from(expected); const b=Buffer.from(v1); return a.length===b.length&&crypto.timingSafeEqual(a,b);
}
function extRef(customer,sale){ const c=customer==='owner'?'owner':String(customer).replace(/-/g,'').toLowerCase(); const s=String(sale).replace(/-/g,'').toLowerCase(); return `VTX-${c}-${s}`; }
function parseExt(ref){ const m=String(ref||'').match(/^VTX-(owner|[0-9a-f]{32})-([0-9a-f]{32})$/i); if(!m)return null; const c=m[1].toLowerCase(); const s=m[2].toLowerCase(); const customer=c==='owner'?'owner':`${c.slice(0,8)}-${c.slice(8,12)}-${c.slice(12,16)}-${c.slice(16,20)}-${c.slice(20)}`; const sale=`${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`; return {customer,sale}; }
function orderPaid(order,amount){ const need=money(amount); const total=money(order?.total_paid_amount||0); const ps=Array.isArray(order?.transactions?.payments)?order.transactions.payments:[]; return (String(order?.status||'').toLowerCase()==='processed'&&total>=need)||ps.some(p=>['approved','processed','accredited'].includes(String(p?.status||'').toLowerCase())&&money(p?.paid_amount??p?.amount??0)>=need); }
function orderStatus(order,amount){ const s=String(order?.status||'').toLowerCase(); if(orderPaid(order,amount))return 'paid'; if(s==='cancelled'||s==='canceled')return 'cancelled'; if(s==='expired')return 'expired'; return 'pending'; }
function paymentId(order){ const ps=Array.isArray(order?.transactions?.payments)?order.transactions.payments:[]; const p=ps.find(x=>['approved','processed','accredited'].includes(String(x?.status||'').toLowerCase()))||ps[0]; return p?.id?String(p.id):null; }
function upsertPayment(sale,status,pid,now){ const e=db.prepare('SELECT id FROM payment_orders WHERE sale_id=?').get(sale.id); if(e)db.prepare('UPDATE payment_orders SET provider_order_id=?,provider_payment_id=?,status=?,amount=?,checkout_url=?,updated_at=? WHERE sale_id=?').run(sale.mp_order_id,pid,status,sale.amount,sale.checkout_url||'',now,sale.id); else db.prepare('INSERT INTO payment_orders VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(uuid(),sale.id,sale.customer_id,'mercado_pago',sale.mp_order_id,pid,status,sale.amount,sale.checkout_url||'',now,now); }
async function mp(path,options={}){
  if(!process.env.MERCADOPAGO_ACCESS_TOKEN)throw new Error('Mercado Pago não configurado no servidor.');
  const ctl=new AbortController(); const timer=setTimeout(()=>ctl.abort(),15000);
  try{ const r=await fetch(`https://api.mercadopago.com${path}`,{...options,signal:ctl.signal,headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}`,...(options.headers||{})}}); const text=await r.text(); let data={}; try{data=text?JSON.parse(text):{};}catch{} if(!r.ok){const e=new Error(`Mercado Pago: ${data?.message||data?.error||`HTTP ${r.status}`}`);e.status=r.status;e.provider=data;throw e;} return data; } finally{clearTimeout(timer);} }
async function syncOrder(orderId,fallbackCustomer=null,fallbackSale=null){ const order=await mp(`/v1/orders/${encodeURIComponent(orderId)}`); let sale=db.prepare('SELECT * FROM sales WHERE mp_order_id=?').get(String(orderId)); if(!sale){const p=parseExt(order.external_reference);const cid=p?.customer||fallbackCustomer;const sid=p?.sale||fallbackSale;if(!cid||!sid)return null;const amount=money(order.total_amount);if(!Number.isFinite(amount)||amount<=0)return null;sale=db.prepare('SELECT * FROM sales WHERE id=?').get(sid);const status=orderStatus(order,amount);const pid=paymentId(order);const now=new Date().toISOString();if(sale){if(sale.customer_id!==cid)return null;db.prepare('UPDATE sales SET amount=?,status=?,mp_order_id=?,mp_payment_id=?,checkout_url=?,paid_at=CASE WHEN ?="paid" THEN COALESCE(paid_at,?) ELSE paid_at END,external_reference=? WHERE id=?').run(amount,status,String(order.id),pid,String(order.checkout_url||sale.checkout_url||''),status,now,String(order.external_reference||extRef(cid,sid)),sid);}else{db.prepare('INSERT INTO sales(id,customer_id,amount,product,channel,status,mp_order_id,mp_payment_id,checkout_url,paid_at,created_at,external_reference) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(sid,cid,amount,String(order.items?.[0]?.title||'Venda VÉRTICE'),'mercado_pago',status,String(order.id),pid,String(order.checkout_url||''),status==='paid'?now:null,String(order.date_created||now),String(order.external_reference||extRef(cid,sid)));sale=db.prepare('SELECT * FROM sales WHERE id=?').get(sid);} } const status=orderStatus(order,sale.amount); const now=new Date().toISOString(); const pid=paymentId(order); db.prepare('UPDATE sales SET status=?,mp_payment_id=COALESCE(?,mp_payment_id),paid_at=CASE WHEN ?="paid" THEN COALESCE(paid_at,?) ELSE paid_at END WHERE id=?').run(status,pid,status,now,sale.id); sale=db.prepare('SELECT * FROM sales WHERE id=?').get(sale.id); upsertPayment(sale,status,pid,now); return {sale,order,status}; }
function aiFallback(msg,mode){ const t=String(msg||'').trim(); const l=t.toLowerCase(); if(l.includes('produto')||l.includes('crie')||l.includes('oferta'))return `VÉRTICE — ${mode}: estruturar produto em problema, público comprador, proposta de valor, MVP e teste de mercado. Escopo: somente o solicitado; restante preservado.`; if(l.includes('mercado')||l.includes('concorr')||l.includes('tend'))return `VÉRTICE — ${mode}: separar evidência de hipótese e analisar demanda, reclamações, concorrentes, preço, canais e lacunas antes da decisão.`; if(l.includes('venda')||l.includes('fatur')||l.includes('receita'))return `VÉRTICE — ${mode}: priorizar receita paga, ticket, volume, conversão e pendências. A estratégia deve ser melhorada sem alterar o que não foi solicitado.`; return `VÉRTICE — ${mode}: comando recebido. Vou analisar antes de agir, manter o escopo solicitado e preservar o restante.`; }
async function aiReply(msg,mode){ const key=process.env.VERTICE_AI_API_KEY||process.env.GROQ_API_KEY||process.env.OPENAI_API_KEY||''; const base=String(process.env.VERTICE_AI_BASE_URL||(process.env.GROQ_API_KEY?'https://api.groq.com/openai/v1':process.env.OPENAI_API_KEY?'https://api.openai.com/v1':'' )).replace(/\/$/,''); if(!key||!base)return aiFallback(msg,mode); const model=process.env.VERTICE_AI_MODEL||(process.env.GROQ_API_KEY?'llama-3.3-70b-versatile':'gpt-4o-mini'); const ctl=new AbortController();const timer=setTimeout(()=>ctl.abort(),20000); try{const r=await fetch(`${base}/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},body:JSON.stringify({model,temperature:0.2,messages:[{role:'system',content:`Você é o VÉRTICE, operador autônomo de negócios. Responda em português. Modo: ${mode}. Analise antes de agir, não invente dados, diferencie hipótese de evidência e preserve tudo que não foi solicitado. Nunca revele credenciais.`},{role:'user',content:String(msg).slice(0,6000)}]}),signal:ctl.signal});const d=await r.json();if(!r.ok)throw new Error(`AI HTTP ${r.status}`);const a=String(d?.choices?.[0]?.message?.content||'').trim();if(!a)throw new Error('Resposta vazia');return a;}catch(e){console.error('AI:',e.message);return aiFallback(msg,mode);}finally{clearTimeout(timer);} }

app.get('/health',(req,res)=>res.json({ok:true,service:'vertice',version:'1.4.0',capabilities:['comando','operacao','monitoramento','ai','mercado_pago'],markets:VERTICE_MARKETS.map(m=>m.countryCode)}));
app.get('/markets',(req,res)=>res.json({ok:true,defaultCountry:'BR',markets:VERTICE_MARKETS}));
app.post('/auth/register',async(req,res)=>{const email=String(req.body?.email||'').trim().toLowerCase();const password=String(req.body?.password||'');if(!email||password.length<8||password.length>128)return res.status(400).json({error:'Informe e-mail válido e senha entre 8 e 128 caracteres.'});try{const id=uuid(),now=new Date().toISOString(),hash=await bcrypt.hash(password,12);db.prepare('INSERT INTO customers VALUES(?,?,?,?)').run(id,email,hash,now);db.prepare('INSERT INTO subscriptions VALUES(?,?,?,?,?,?)').run(uuid(),id,'basic','pending',null,now);res.status(201).json({token:tokenFor(id,email,'CUSTOMER'),role:'CUSTOMER',customer:{id,email}});}catch{res.status(409).json({error:'Conta já existente ou dados inválidos.'});}});
app.post('/auth/login',async(req,res)=>{const ip=req.ip||req.socket.remoteAddress||'unknown';if(!limitLogin(`login:${ip}`))return res.status(429).json({error:'Muitas tentativas. Aguarde um momento.'});const login=String(req.body?.login||req.body?.email||'').trim().toLowerCase();const password=String(req.body?.password||'');if(login===OWNER_LOGIN.toLowerCase()&&password===OWNER_PASSWORD)return res.json({token:tokenFor('owner',OWNER_LOGIN,'OWNER'),role:'OWNER',customer:{id:'owner',email:OWNER_LOGIN}});const c=db.prepare('SELECT * FROM customers WHERE email=?').get(login);if(!c||!(await bcrypt.compare(password,c.password_hash)))return res.status(401).json({error:'Login ou senha inválidos.'});res.json({token:tokenFor(c.id,c.email,'CUSTOMER'),role:'CUSTOMER',customer:{id:c.id,email:c.email}});});
app.get('/me',auth,(req,res)=>{if(req.user.role==='OWNER')return res.json({role:'OWNER',customer:{id:'owner',email:req.user.email},subscription:{plan:'owner',status:'active',currentPeriodEnd:null}});const s=sub(req.user.sub);res.json({role:'CUSTOMER',customer:{id:req.user.sub,email:req.user.email},subscription:s?{plan:s.plan,status:s.status,currentPeriodEnd:s.current_period_end}:null});});
app.post('/devices/register',auth,(req,res)=>{if(req.user.role!=='CUSTOMER')return res.status(403).json({error:'Use o terminal do proprietário.'});const id=String(req.body?.deviceId||'').trim(),mode=String(req.body?.mode||'').trim(),name=String(req.body?.deviceName||'').trim().slice(0,100);if(!id||!['comando','operacao','monitoramento'].includes(mode))return res.status(400).json({error:'deviceId e mode são obrigatórios.'});const now=new Date().toISOString();db.prepare('INSERT INTO devices(id,customer_id,device_name,mode,last_seen_at,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET customer_id=excluded.customer_id,device_name=excluded.device_name,mode=excluded.mode,last_seen_at=excluded.last_seen_at').run(id,req.user.sub,name,mode,now,now);res.json({ok:true,deviceId:id,mode});});
app.get('/devices',auth,(req,res)=>{const cid=customerId(req);const rows=db.prepare('SELECT id,device_name AS deviceName,mode,last_seen_at AS lastSeenAt,created_at AS createdAt FROM devices WHERE customer_id=? ORDER BY last_seen_at DESC').all(cid);res.json({devices:rows});});

app.listen(PORT,()=>console.log(`VÉRTICE backend ouvindo na porta ${PORT}`));

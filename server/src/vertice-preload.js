const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || 'vertice.db';
const db = new Database(DB_PATH);
const originalListen = express.application.listen;
let installed = false;

function jsonError(res, status, error) { return res.status(status).json({ error }); }
function getToken(req) {
  const h = String(req.headers.authorization || '');
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}
function verify(req) {
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) return null;
    return jwt.verify(getToken(req), secret);
  } catch { return null; }
}
function cleanMode(value) {
  const mode = String(value || 'comando').trim().toLowerCase();
  return ['comando','operacao','monitoramento'].includes(mode) ? mode : null;
}
function fallback(message, mode) {
  const text = String(message || '').trim();
  const lower = text.toLowerCase();
  if (lower.includes('produto') || lower.includes('crie') || lower.includes('oferta')) return {
    answer: `VÉRTICE — ${mode}: vou estruturar a oportunidade em problema, público comprador, proposta de valor, MVP e teste. Escopo: somente o solicitado; demais configurações preservadas.\n\nPróxima ação: transformar o pedido em uma especificação vendável e mensurável.`,
    actions: [{ type:'plan', label:'Estruturar oportunidade' }]
  };
  if (lower.includes('mercado') || lower.includes('concorr') || lower.includes('tend')) return {
    answer: `VÉRTICE — ${mode}: uma análise de mercado precisa separar evidência de hipótese. Vou olhar demanda, reclamações, concorrência, preço, canais e lacunas antes de recomendar uma mudança.`,
    actions: [{ type:'research', label:'Definir radar de mercado' }]
  };
  if (lower.includes('venda') || lower.includes('fatur') || lower.includes('receita')) return {
    answer: `VÉRTICE — ${mode}: foco comercial em receita paga, ticket, volume, conversão e pendências. A regra é melhorar a estratégia sem alterar o que não foi solicitado.`,
    actions: [{ type:'sales', label:'Analisar vendas' }]
  };
  return {
    answer: `VÉRTICE — ${mode}: comando recebido. Vou manter o escopo em “somente_o_solicitado”, preservar as demais configurações e organizar a próxima ação verificável.`,
    actions: [{ type:'command', label:'Enviar para operação' }]
  };
}
function aiBaseUrl() {
  return String(process.env.VERTICE_AI_BASE_URL || (process.env.GROQ_API_KEY ? 'https://api.groq.com/openai/v1' : '') || (process.env.OPENAI_API_KEY ? 'https://api.openai.com/v1' : '')).replace(/\/$/, '');
}
async function aiReply(message, mode) {
  const key = process.env.VERTICE_AI_API_KEY || process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY || '';
  const base = aiBaseUrl();
  if (!key || !base) return fallback(message, mode);
  const model = process.env.VERTICE_AI_MODEL || (process.env.GROQ_API_KEY ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini');
  const payload = {
    model,
    temperature: 0.2,
    messages: [
      { role:'system', content:`Você é o VÉRTICE, operador autônomo de negócios. Responda em português e com linguagem executiva. Modo: ${mode}. Analise antes de agir, não invente métricas, diferencie hipótese de evidência e preserve tudo que não foi solicitado. Quando a ação exigir sistema externo, descreva o plano e não finja que executou.` },
      { role:'user', content:String(message || '').slice(0,6000) }
    ]
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const r = await fetch(`${base}/chat/completions`, { method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`}, body:JSON.stringify(payload), signal:controller.signal });
    const data = await r.json();
    if (!r.ok) throw new Error(`AI HTTP ${r.status}`);
    const answer = String(data?.choices?.[0]?.message?.content || '').trim();
    if (!answer) throw new Error('Resposta vazia');
    return { answer, actions:[{ type:'ai', label:'Análise concluída' }] };
  } catch (e) {
    console.error('[vertice-preload] AI fallback:', e.message);
    return fallback(message, mode);
  } finally { clearTimeout(timer); }
}
function install(app) {
  if (installed || !app || typeof app.post !== 'function') return;
  installed = true;

  app.post('/ai/chat', async (req,res) => {
    const user = verify(req);
    if (!user) return jsonError(res,401,'Sessão inválida');
    if (user.role !== 'OWNER') {
      const sub = db.prepare('SELECT status,current_period_end FROM subscriptions WHERE customer_id=? ORDER BY updated_at DESC LIMIT 1').get(user.sub);
      if (!sub || sub.status !== 'active' || (sub.current_period_end && new Date(sub.current_period_end) < new Date())) return jsonError(res,402,'Assinatura não está ativa.');
    }
    const message = String(req.body?.message || '').trim();
    const mode = cleanMode(req.body?.mode);
    if (!message || message.length > 6000 || !mode) return jsonError(res,400,'Mensagem ou modo inválido.');
    const result = await aiReply(message, mode);
    return res.json({ ok:true, ...result, executionPolicy:{ scope:'somente_o_solicitado', preservar_demais_configuracoes:true } });
  });

  app.post('/owner/devices/register', (req,res) => {
    const user = verify(req); if (!user || user.role !== 'OWNER') return jsonError(res,403,'Acesso de proprietário necessário.');
    const deviceId = String(req.body?.deviceId || '').trim(); const mode = cleanMode(req.body?.mode); const name = String(req.body?.deviceName || '').trim().slice(0,100);
    if (!deviceId || !mode || !name) return jsonError(res,400,'deviceId, mode e deviceName são obrigatórios.');
    const now = new Date().toISOString(); const old = db.prepare('SELECT id,customer_id FROM devices WHERE id=?').get(deviceId);
    if (old && old.customer_id !== 'owner') return jsonError(res,403,'Dispositivo pertence a outra conta.');
    if (old) db.prepare('UPDATE devices SET mode=?,device_name=?,last_seen_at=? WHERE id=?').run(mode,name,now,deviceId);
    else db.prepare('INSERT INTO devices VALUES(?,?,?,?,?,?)').run(deviceId,'owner',name,mode,now,now);
    return res.json({ok:true,deviceId,mode});
  });

  app.post('/owner/commands', (req,res) => {
    const user = verify(req); if (!user || user.role !== 'OWNER') return jsonError(res,403,'Acesso de proprietário necessário.');
    const command = String(req.body?.command || '').trim(); const mode = cleanMode(req.body?.mode); const deviceId = String(req.body?.deviceId || '').trim();
    if (!command || command.length > 2000 || !mode) return jsonError(res,400,'Comando ou modo inválido.');
    if (deviceId) { const d = db.prepare('SELECT customer_id FROM devices WHERE id=?').get(deviceId); if (!d || d.customer_id !== 'owner') return jsonError(res,403,'Dispositivo não pertence ao proprietário.'); }
    const id = crypto.randomUUID(); const now = new Date().toISOString();
    db.prepare('INSERT INTO commands VALUES(?,?,?,?,?,?,?)').run(id,'owner',deviceId || null,mode,command,'queued',now);
    return res.status(202).json({id,status:'queued',message:'Comando recebido pelo VÉRTICE.',executionPolicy:{scope:'somente_o_solicitado',preserveUnrequested:true}});
  });
}

express.application.listen = function(...args) {
  install(this);
  return originalListen.apply(this,args);
};

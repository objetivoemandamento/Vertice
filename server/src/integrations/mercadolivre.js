const crypto = require('crypto');

const API_BASE = 'https://api.mercadolibre.com';
const AUTH_BASE = 'https://auth.mercadolivre.com.br/authorization';

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw Object.assign(new Error(`Configuração ausente: ${name}`), { status: 503 });
  return value;
}

function authorizationUrl(state) {
  const url = new URL(AUTH_BASE);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', required('MERCADOLIVRE_CLIENT_ID'));
  url.searchParams.set('redirect_uri', required('MERCADOLIVRE_REDIRECT_URI'));
  url.searchParams.set('state', state);
  return url.toString();
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { Accept: 'application/json', ...(options.headers || {}) },
    signal: AbortSignal.timeout(15000)
  });
  const raw = await response.text();
  let body = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch {}
  if (!response.ok) {
    const error = new Error(String(body.message || body.error || `Mercado Livre HTTP ${response.status}`));
    error.status = response.status >= 500 ? 502 : response.status;
    throw error;
  }
  return body;
}

async function exchangeCode(code) {
  return requestJson(`${API_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: required('MERCADOLIVRE_CLIENT_ID'),
      client_secret: required('MERCADOLIVRE_CLIENT_SECRET'),
      code: String(code),
      redirect_uri: required('MERCADOLIVRE_REDIRECT_URI')
    })
  });
}

async function refreshAccessToken(refreshToken) {
  return requestJson(`${API_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: required('MERCADOLIVRE_CLIENT_ID'),
      client_secret: required('MERCADOLIVRE_CLIENT_SECRET'),
      refresh_token: String(refreshToken)
    })
  });
}

async function apiRequest(path, accessToken, options = {}) {
  if (!String(path).startsWith('/')) throw new Error('Caminho de API inválido.');
  return requestJson(`${API_BASE}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${accessToken}`, ...(options.headers || {}) }
  });
}

function encryptToken(value) {
  const key = Buffer.from(required('MERCADOLIVRE_TOKEN_ENCRYPTION_KEY'), 'base64');
  if (key.length !== 32) throw new Error('MERCADOLIVRE_TOKEN_ENCRYPTION_KEY deve ser uma chave base64 de 32 bytes.');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join('.');
}

function decryptToken(value) {
  const key = Buffer.from(required('MERCADOLIVRE_TOKEN_ENCRYPTION_KEY'), 'base64');
  if (key.length !== 32) throw new Error('MERCADOLIVRE_TOKEN_ENCRYPTION_KEY deve ser uma chave base64 de 32 bytes.');
  const [iv, tag, data] = String(value).split('.');
  if (!iv || !tag || !data) throw new Error('Token armazenado inválido.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

module.exports = { authorizationUrl, exchangeCode, refreshAccessToken, apiRequest, encryptToken, decryptToken };

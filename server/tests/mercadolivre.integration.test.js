const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const { createMercadoLivreRouter } = require('../src/integrations/mercadolivreRoutes');
const { encryptToken, decryptToken, authorizationUrl } = require('../src/integrations/mercadolivre');

process.env.MERCADOLIVRE_CLIENT_ID = 'test-client';
process.env.MERCADOLIVRE_CLIENT_SECRET = 'test-secret';
process.env.MERCADOLIVRE_REDIRECT_URI = 'http://127.0.0.1/callback';
process.env.MERCADOLIVRE_TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');

const secret = 'test-jwt-secret-that-is-long-enough-for-this-test-only';
const context = { tenantId: '11111111-1111-4111-8111-111111111111', userId: '22222222-2222-4222-8222-222222222222' };
let connectionRow = null;

function fakeQuery(sql, params = []) {
  if (sql.includes('insert into marketplace_connections')) {
    connectionRow = {
      tenant_id: params[0], user_id: params[1], external_user_id: params[2],
      access_token_enc: params[3], refresh_token_enc: params[4], expires_at: params[5],
      scopes: params[6], updated_at: new Date().toISOString()
    };
    return Promise.resolve({ rows: [], rowCount: 1 });
  }
  if (sql.includes('select external_user_id, access_token_enc, refresh_token_enc, expires_at')) {
    return Promise.resolve({ rows: connectionRow ? [connectionRow] : [] });
  }
  if (sql.includes('select refresh_token_enc from marketplace_connections')) {
    return Promise.resolve({ rows: connectionRow ? [{ refresh_token_enc: connectionRow.refresh_token_enc }] : [] });
  }
  if (sql.includes('select external_user_id, expires_at, updated_at')) {
    return Promise.resolve({ rows: connectionRow ? [connectionRow] : [] });
  }
  throw new Error('Unexpected test query: ' + sql);
}

async function runWithTenantContext(_context, fn) { return fn(); }

function auth(req, res, next) {
  try {
    const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
    req.user = jwt.verify(token, secret, { issuer: 'vertice', audience: 'vertice-app' });
    next();
  } catch { res.status(401).json({ error: 'unauthorized' }); }
}

test('Mercado Livre token encryption and authorization URL', () => {
  const token = 'sensitive-token-value';
  assert.equal(decryptToken(encryptToken(token)), token);
  const url = new URL(authorizationUrl('state-test'));
  assert.equal(url.origin, 'https://auth.mercadolivre.com.br');
  assert.equal(url.searchParams.get('client_id'), 'test-client');
  assert.equal(url.searchParams.get('state'), 'state-test');
});

test('OAuth connection, status, items, orders and paused listing flow', async t => {
  connectionRow = null;
  const originalFetch = global.fetch;
  global.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    if (url.pathname === '/oauth/token') {
      return new Response(JSON.stringify({
        access_token: 'access-test', refresh_token: 'refresh-test', expires_in: 21600, scope: 'read write'
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname === '/users/me') {
      return new Response(JSON.stringify({ id: 123456, nickname: 'seller-test' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname === '/users/123456/items/search') {
      return new Response(JSON.stringify({ results: ['MLB1'], paging: { total: 1 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname === '/orders/search') {
      return new Response(JSON.stringify({ results: [{ id: 789 }], paging: { total: 1 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname === '/items' && options.method === 'POST') {
      const payload = JSON.parse(options.body);
      assert.equal(payload.status, 'paused');
      return new Response(JSON.stringify({ id: 'MLB2', status: 'paused' }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ message: 'not found', path: url.pathname }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  };

  const app = express();
  app.use(express.json());
  app.use('/integrations/mercadolivre', createMercadoLivreRouter({
    auth, jwt, jwtSecret: secret, query: fakeQuery, runWithTenantContext
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    global.fetch = originalFetch;
    await new Promise(resolve => server.close(resolve));
  });
  const base = 'http://127.0.0.1:' + server.address().port + '/integrations/mercadolivre';
  const token = jwt.sign({ sub: context.userId, tenant_id: context.tenantId, role: 'CUSTOMER' }, secret, { issuer: 'vertice', audience: 'vertice-app', expiresIn: '5m' });
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

  const connect = await originalFetch(base + '/connect', { headers });
  assert.equal(connect.status, 302);
  const state = new URL(connect.headers.get('location')).searchParams.get('state');
  assert.ok(state);

  const callback = await originalFetch(base + '/callback?code=test-code&state=' + encodeURIComponent(state));
  assert.equal(callback.status, 200);
  assert.equal((await callback.json()).connected, true);
  assert.ok(connectionRow.access_token_enc !== 'access-test');

  const status = await originalFetch(base + '/status', { headers });
  assert.equal((await status.json()).connected, true);

  const me = await originalFetch(base + '/me', { headers });
  assert.equal((await me.json()).id, 123456);

  const items = await originalFetch(base + '/items', { headers });
  assert.deepEqual((await items.json()).results, ['MLB1']);

  const orders = await originalFetch(base + '/orders', { headers });
  assert.equal((await orders.json()).results[0].id, 789);

  const listing = await originalFetch(base + '/items', {
    method: 'POST', headers,
    body: JSON.stringify({
      title: 'Produto de teste VÉRTICE', categoryId: 'MLB1234', price: 100,
      availableQuantity: 1, condition: 'new', pictures: [{ source: 'https://example.com/item.jpg' }]
    })
  });
  assert.equal(listing.status, 201);
  assert.equal((await listing.json()).item.status, 'paused');

  const unauthorized = await originalFetch(base + '/status');
  assert.equal(unauthorized.status, 401);
});

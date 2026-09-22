const { Pool } = require('pg');
const { AsyncLocalStorage } = require('node:async_hooks');

const databaseUrl = String(process.env.DATABASE_URL || '').trim();
if (!databaseUrl) throw new Error('DATABASE_URL é obrigatório para o backend VÉRTICE.');

const tenantStorage = new AsyncLocalStorage();
const isLocal = /localhost|127\\.0.0.1/.test(databaseUrl);
const rejectUnauthorized = String(process.env.DB_SSL_REJECT_UNAUTHORIZED || 'true').toLowerCase() !== 'false';

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: isLocal ? false : { rejectUnauthorized },
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30000),
  connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 10000),
  statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS || 15000),
  query_timeout: Number(process.env.DB_QUERY_TIMEOUT_MS || 15000),
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000
});

pool.on('error', err => console.error('[vertice-db] idle client error:', err.message));

function currentContext() {
  return tenantStorage.getStore();
}

function requireContext() {
  const ctx = currentContext();
  if (!ctx?.tenantId || !ctx?.userId) throw new Error('TENANT_CONTEXT_REQUIRED');
  return ctx;
}

async function query(text, params = []) {
  const ctx = currentContext();
  if (!ctx?.tenantId || !ctx?.userId) return pool.query(text, params);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('select set_config($1,$2,true)', ['app.tenant_id', ctx.tenantId]);
    await client.query('select set_config($1,$2,true)', ['app.user_id', ctx.userId]);
    const result = await client.query(text, params);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ctx = currentContext();
    if (ctx?.tenantId && ctx?.userId) {
      await client.query('select set_config($1,$2,true)', ['app.tenant_id', ctx.tenantId]);
      await client.query('select set_config($1,$2,true)', ['app.user_id', ctx.userId]);
    }
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

function runWithTenantContext(context, fn) {
  if (!context?.tenantId || !context?.userId) throw new Error('INVALID_TENANT_CONTEXT');
  return tenantStorage.run(context, fn);
}

async function waitForDatabase(retries = 8) {
  let last;
  for (let i = 0; i < retries; i += 1) {
    try { await query('select 1 as ok'); return true; }
    catch (error) { last = error; await new Promise(resolve => setTimeout(resolve, Math.min(1000 * (i + 1), 5000))); }
  }
  throw last || new Error('Banco indisponível.');
}

async function closeDatabase() { await pool.end(); }

module.exports = { pool, query, withTransaction, runWithTenantContext, requireContext, waitForDatabase, closeDatabase };

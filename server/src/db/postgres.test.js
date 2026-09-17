const assert = require('node:assert/strict');

process.env.DATABASE_URL = 'postgresql://example.invalid/vertice';
process.env.PG_POOL_MAX = '7';
const { createPool } = require('./postgres');
const pool = createPool();
assert.equal(pool.options.max, 7);
assert.equal(pool.options.connectionTimeoutMillis, 10_000);
assert.equal(pool.options.idleTimeoutMillis, 30_000);
assert.equal(typeof pool.query, 'function');
await pool.end();
console.log('postgres-adapter: PASS');

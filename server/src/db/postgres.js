const { Pool } = require('pg');

function createPool(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL não configurado.');
  return new Pool({ connectionString, max: Number(process.env.PG_POOL_MAX || 10), idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000, ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false } });
}

async function ensureSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS customers(id UUID PRIMARY KEY,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL);
    CREATE TABLE IF NOT EXISTS subscriptions(id UUID PRIMARY KEY,customer_id UUID NOT NULL REFERENCES customers(id),plan TEXT NOT NULL,status TEXT NOT NULL,current_period_end TIMESTAMPTZ,updated_at TIMESTAMPTZ NOT NULL);
    CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,customer_id TEXT NOT NULL,device_name TEXT,mode TEXT,last_seen_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL);
    CREATE TABLE IF NOT EXISTS commands(id UUID PRIMARY KEY,customer_id TEXT NOT NULL,device_id TEXT,mode TEXT,command TEXT NOT NULL,status TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL);
    CREATE TABLE IF NOT EXISTS command_executions(id UUID PRIMARY KEY,command_id UUID UNIQUE NOT NULL REFERENCES commands(id),execution_id UUID UNIQUE NOT NULL,lease_id UUID UNIQUE NOT NULL,attempt INTEGER NOT NULL,started_at TIMESTAMPTZ NOT NULL,heartbeat_at TIMESTAMPTZ NOT NULL,expires_at TIMESTAMPTZ NOT NULL);
    CREATE TABLE IF NOT EXISTS audit_events(id UUID PRIMARY KEY,request_id TEXT,actor_id TEXT,actor_role TEXT,action TEXT NOT NULL,target_id TEXT,metadata JSONB,created_at TIMESTAMPTZ NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_commands_customer_created ON commands(customer_id,created_at);
    CREATE INDEX IF NOT EXISTS idx_devices_customer ON devices(customer_id);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(created_at);
  `);
}

module.exports = { createPool, ensureSchema };

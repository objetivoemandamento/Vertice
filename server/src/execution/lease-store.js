const crypto = require('crypto');

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const DEFAULT_TTL_MS = 30000;

function createExecution(commandId, now = Date.now(), ttlMs = DEFAULT_TTL_MS) {
  if (!commandId) throw new Error('commandId obrigatório');
  const executionId = crypto.randomUUID();
  const leaseId = crypto.randomUUID();
  return { commandId: String(commandId), executionId, leaseId, attempt: 1, startedAt: now, heartbeatAt: now, expiresAt: now + ttlMs };
}
function renew(execution, now = Date.now(), ttlMs = DEFAULT_TTL_MS) {
  if (!execution || now > execution.expiresAt) throw new Error('Lease expirado');
  return { ...execution, heartbeatAt: now, expiresAt: now + ttlMs };
}
function expired(execution, now = Date.now()) { return !execution || !Number.isFinite(execution.expiresAt) || now > execution.expiresAt; }
function retry(execution, now = Date.now(), ttlMs = DEFAULT_TTL_MS) {
  if (!execution) throw new Error('Execução ausente');
  return { ...createExecution(execution.commandId, now, ttlMs), attempt: execution.attempt + 1 };
}
function canFinalize(execution, leaseId, now = Date.now()) { return Boolean(execution && leaseId && execution.leaseId === leaseId && !expired(execution, now)); }
module.exports = { TERMINAL, DEFAULT_TTL_MS, createExecution, renew, expired, retry, canFinalize };

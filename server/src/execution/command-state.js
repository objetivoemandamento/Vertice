const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const STATES = new Set(['queued', 'running', 'completed', 'failed', 'cancelled', 'unknown']);

function assertState(state) {
  if (!STATES.has(state)) throw new Error(`Estado inválido: ${state}`);
}

function transition(current, next) {
  assertState(current);
  assertState(next);
  if (TERMINAL.has(current) && next !== current) {
    throw new Error(`Transição proibida: ${current} -> ${next}`);
  }
  const allowed = {
    queued: new Set(['running', 'cancelled']),
    running: new Set(['completed', 'failed', 'cancelled', 'unknown']),
    unknown: new Set(['running', 'failed', 'cancelled']),
    completed: new Set(['completed']),
    failed: new Set(['failed']),
    cancelled: new Set(['cancelled']),
  };
  if (!allowed[current].has(next)) throw new Error(`Transição proibida: ${current} -> ${next}`);
  return next;
}

function createLease(commandId, executionId, now = Date.now(), ttlMs = 30000) {
  if (!commandId || !executionId) throw new Error('commandId e executionId são obrigatórios');
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('ttlMs inválido');
  return {
    commandId: String(commandId),
    executionId: String(executionId),
    startedAt: now,
    heartbeatAt: now,
    expiresAt: now + ttlMs,
    attempt: 1,
  };
}

function heartbeat(lease, now = Date.now(), ttlMs = 30000) {
  if (!lease || now > lease.expiresAt) throw new Error('Lease expirado');
  return { ...lease, heartbeatAt: now, expiresAt: now + ttlMs };
}

function isLeaseAlive(lease, now = Date.now()) {
  return Boolean(lease && Number.isFinite(lease.expiresAt) && now <= lease.expiresAt);
}

function nextAttempt(lease, now = Date.now(), ttlMs = 30000) {
  if (!lease) throw new Error('Lease ausente');
  return { ...createLease(lease.commandId, `${lease.executionId}:retry`, now, ttlMs), attempt: lease.attempt + 1 };
}

module.exports = { STATES, TERMINAL, transition, createLease, heartbeat, isLeaseAlive, nextAttempt };

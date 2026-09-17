const assert = require('node:assert/strict');
const {
  transition,
  createLease,
  heartbeat,
  isLeaseAlive,
  nextAttempt,
} = require('./command-state');

assert.equal(transition('queued', 'running'), 'running');
assert.equal(transition('running', 'completed'), 'completed');
assert.equal(transition('running', 'unknown'), 'unknown');
assert.equal(transition('unknown', 'running'), 'running');
assert.equal(transition('completed', 'completed'), 'completed');
assert.throws(() => transition('completed', 'running'));
assert.throws(() => transition('queued', 'completed'));

const lease = createLease('cmd-1', 'exec-1', 1000, 100);
assert.equal(lease.attempt, 1);
assert.equal(isLeaseAlive(lease, 1050), true);
assert.equal(isLeaseAlive(lease, 1101), false);

const renewed = heartbeat(lease, 1050, 100);
assert.equal(renewed.expiresAt, 1150);
assert.throws(() => heartbeat(lease, 1101, 100));

const retry = nextAttempt(renewed, 1150, 100);
assert.equal(retry.attempt, 2);
assert.equal(retry.commandId, 'cmd-1');

console.log('command-state: PASS');

const assert = require('node:assert/strict');
const { createExecution, renew, expired, retry, canFinalize } = require('./lease-store');

const e = createExecution('cmd-1', 1000, 100);
assert.equal(e.attempt, 1);
assert.equal(expired(e, 1099), false);
assert.equal(expired(e, 1101), true);
const r = renew(e, 1050, 100);
assert.equal(r.expiresAt, 1150);
assert.equal(canFinalize(r, r.leaseId), true);
assert.equal(canFinalize(r, 'other-lease'), false);
const x = retry(r, 1200, 100);
assert.equal(x.attempt, 2);
assert.notEqual(x.executionId, r.executionId);
assert.throws(() => renew(e, 1101, 100));
console.log('lease-store: PASS');

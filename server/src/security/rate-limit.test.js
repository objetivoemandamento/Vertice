const assert = require('node:assert/strict');
const { SlidingWindowRateLimiter } = require('./rate-limit');

const limiter = new SlidingWindowRateLimiter({ limit: 2, windowMs: 1_000 });
assert.equal(limiter.allow('ip', 1_000).allowed, true);
assert.equal(limiter.allow('ip', 1_100).allowed, true);
const blocked = limiter.allow('ip', 1_200);
assert.equal(blocked.allowed, false);
assert.ok(blocked.retryAfterMs > 0);
assert.equal(limiter.allow('other', 1_200).allowed, true);
assert.equal(limiter.allow('ip', 2_001).allowed, true);
console.log('rate-limit: PASS');

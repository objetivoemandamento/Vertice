const assert = require('node:assert/strict');
const { SlidingWindowRateLimiter } = require('./security/rate-limit');

const limiter = new SlidingWindowRateLimiter({ limit: 2, windowMs: 1_000, maxKeys: 2 });
assert.equal(limiter.allow('a', 1_000).allowed, true);
assert.equal(limiter.allow('a', 1_100).allowed, true);
const blocked = limiter.allow('a', 1_200);
assert.equal(blocked.allowed, false);
assert.equal(blocked.remaining, 0);
assert.ok(blocked.retryAfterMs > 0);
assert.equal(limiter.allow('a', 2_001).allowed, true);
console.log('security-preload contract: PASS');
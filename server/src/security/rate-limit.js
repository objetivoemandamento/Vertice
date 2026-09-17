class SlidingWindowRateLimiter {
  constructor({ limit = 30, windowMs = 60_000, maxKeys = 10_000 } = {}) {
    this.limit = Math.max(1, Number(limit));
    this.windowMs = Math.max(1_000, Number(windowMs));
    this.maxKeys = Math.max(100, Number(maxKeys));
    this.buckets = new Map();
  }

  allow(key, now = Date.now()) {
    const id = String(key || 'anonymous');
    const cutoff = now - this.windowMs;
    let bucket = this.buckets.get(id) || [];
    bucket = bucket.filter(ts => ts > cutoff);
    if (bucket.length >= this.limit) {
      this.buckets.set(id, bucket);
      return { allowed: false, remaining: 0, retryAfterMs: Math.max(1, bucket[0] + this.windowMs - now) };
    }
    bucket.push(now);
    this.buckets.set(id, bucket);
    this.compact(now);
    return { allowed: true, remaining: Math.max(0, this.limit - bucket.length), retryAfterMs: 0 };
  }

  compact(now = Date.now()) {
    const cutoff = now - this.windowMs;
    for (const [key, bucket] of this.buckets) {
      const fresh = bucket.filter(ts => ts > cutoff);
      if (fresh.length) this.buckets.set(key, fresh);
      else this.buckets.delete(key);
    }
    while (this.buckets.size > this.maxKeys) this.buckets.delete(this.buckets.keys().next().value);
  }
}

module.exports = { SlidingWindowRateLimiter };

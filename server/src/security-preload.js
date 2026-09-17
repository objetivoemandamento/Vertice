const express = require('express');
const crypto = require('crypto');
const { SlidingWindowRateLimiter } = require('./security/rate-limit');

const limiter = new SlidingWindowRateLimiter({
  limit: Number(process.env.VERTICE_RATE_LIMIT || 120),
  windowMs: Number(process.env.VERTICE_RATE_WINDOW_MS || 60_000),
  maxKeys: Number(process.env.VERTICE_RATE_MAX_KEYS || 10_000)
});

const originalUse = express.application.use;
let installed = false;

function clientKey(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.ip || req.socket?.remoteAddress || 'anonymous';
}

function hardeningMiddleware(req, res, next) {
  const requestId = String(req.headers['x-request-id'] || crypto.randomUUID());
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

  if (req.path === '/health') return next();
  const result = limiter.allow(`${clientKey(req)}:${req.method}:${req.path}`);
  res.setHeader('X-RateLimit-Limit', String(limiter.limit));
  res.setHeader('X-RateLimit-Remaining', String(result.remaining));
  if (!result.allowed) {
    res.setHeader('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)));
    return res.status(429).json({ error: 'Muitas solicitações. Tente novamente mais tarde.', requestId });
  }
  next();
}

express.application.use = function (...args) {
  if (!installed) {
    installed = true;
    originalUse.call(this, hardeningMiddleware);
  }
  return originalUse.apply(this, args);
};

module.exports = { limiter };
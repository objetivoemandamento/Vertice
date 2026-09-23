const crypto = require('crypto');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const { runWithTenantContext } = require('../db');

function buildCorsOptions() {
  const allowed = String(process.env.CORS_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean);
  if (!allowed.length) throw new Error('CORS_ORIGINS deve conter pelo menos uma origem explícita.');
  return {
    origin(origin, callback) {
      if (!origin || allowed.includes(origin)) return callback(null, true);
      return callback(new Error('CORS_ORIGIN_DENIED'));
    },
    credentials: true,
    methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
    allowedHeaders: ['Content-Type','Authorization','Idempotency-Key','X-Request-Id'],
    maxAge: 600
  };
}

function buildRateLimiter(redisClient) {
  return rateLimit({
    windowMs: 60000,
    limit: Number(process.env.RATE_LIMIT_PER_MINUTE || 120),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store: new RedisStore({ sendCommand: (...args) => redisClient.call(...args) }),
    keyGenerator: req => {
      const auth = String(req.headers.authorization || '');
      const tokenHash = auth.startsWith('Bearer ') ? crypto.createHash('sha256').update(auth.slice(7)).digest('hex').slice(0,32) : '';
      return tokenHash ? 'auth:' + tokenHash : 'ip:' + ipKeyGenerator(req.ip);
    }
  });
}

function tenantContextMiddleware(verifyAccess) {
  return (req,res,next) => {
    const header = String(req.headers.authorization || '');
    if (!header.startsWith('Bearer ')) return next();
    try {
      const payload = verifyAccess(header.slice(7));
      const tenantId = String(payload.tenant_id || '');
      const userId = String(payload.sub || '');
      if (!/^[0-9a-f-]{36}$/i.test(tenantId) || !/^[0-9a-f-]{36}$/i.test(userId)) return next();
      return runWithTenantContext({
        tenantId,
        userId,
        role: String(payload.role || ''),
        requestId: String(req.headers['x-request-id'] || crypto.randomUUID())
      }, () => next());
    } catch {
      return next();
    }
  };
}

module.exports = { buildCorsOptions, buildRateLimiter, tenantContextMiddleware };

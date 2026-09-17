const crypto = require('crypto');

const ISSUER = process.env.JWT_ISSUER || 'vertice-backend';
const AUDIENCE = process.env.JWT_AUDIENCE || 'vertice-client';
const ACCESS_TTL = process.env.JWT_ACCESS_TTL || '2h';

function tokenClaims(id, email, role) {
  return { sub: String(id), email: String(email), role: String(role), jti: crypto.randomUUID() };
}

function signOptions() {
  return { expiresIn: ACCESS_TTL, issuer: ISSUER, audience: AUDIENCE };
}

function verifyOptions() {
  return { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'] };
}

module.exports = { ISSUER, AUDIENCE, ACCESS_TTL, tokenClaims, signOptions, verifyOptions };

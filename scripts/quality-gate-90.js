const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const files = {
  server: path.join(root, 'server', 'src', 'server.js'),
  preload: path.join(root, 'server', 'src', 'vertice-preload.js'),
  state: path.join(root, 'server', 'src', 'execution', 'command-state.js'),
  lease: path.join(root, 'server', 'src', 'execution', 'lease-store.js'),
  plan: path.join(root, 'server', 'src', 'execution', 'action-plan.js'),
};
function read(file) { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } }
const server = read(files.server), preload = read(files.preload), state = read(files.state), lease = read(files.lease), plan = read(files.plan);
const all = `${server}\n${preload}\n${state}\n${lease}\n${plan}`;
const androidRoot = path.join(root, 'app', 'src', 'main', 'java', 'com', 'vertice', 'launcher');
const accessibility = read(path.join(androidRoot, 'OperationAccessibilityService.kt'));

const checks = [
  { area: 'Backend/API', critical: true, name: 'Express backend exists', pass: Boolean(server) },
  { area: 'Backend/API', critical: true, name: 'JSON strict parsing configured', pass: /express\.json\([^)]*strict\s*:\s*true/.test(server) },
  { area: 'Security', critical: true, name: 'Production JWT secret is mandatory', pass: /JWT_SECRET.*obrigat/.test(server) || /JWT_SECRET.*obrigat/.test(preload) },
  { area: 'Security', critical: true, name: 'Production owner credentials are environment-bound', pass: /OWNER_LOGIN.*OWNER_PASSWORD/.test(preload) || /OWNER_LOGIN.*OWNER_PASSWORD/.test(server) },
  { area: 'Security', critical: true, name: 'JWT verification is used', pass: /jwt\.verify/.test(all) },
  { area: 'Authorization', critical: true, name: 'Owner role is checked server-side', pass: /role===['\"]OWNER['\"]/.test(all) },
  { area: 'Authorization', critical: true, name: 'Device ownership is checked', pass: /customer_id!==customer\(u\)|customer_id!=='owner'/.test(all) },
  { area: 'Command Queue', critical: true, name: 'Commands have queued/running/terminal lifecycle', pass: /queued/.test(all) && /running/.test(all) && /completed/.test(all) && /failed/.test(all) },
  { area: 'Command Queue', critical: true, name: 'Atomic queued-to-running transition exists', pass: /UPDATE commands SET status=["']running/.test(all) },
  { area: 'Command Queue', critical: true, name: 'Explicit UNKNOWN state exists', pass: /unknown/.test(state) && /unknown/.test(all) },
  { area: 'Execution Lease', critical: true, name: 'Execution lease primitives exist', pass: /createExecution/.test(lease) && /renew/.test(lease) && /canFinalize/.test(lease) },
  { area: 'Execution Lease', critical: true, name: 'Lease expiration is explicit', pass: /expiresAt/.test(lease) && /expired/.test(lease) },
  { area: 'Idempotency', critical: true, name: 'Payment creation uses idempotency key', pass: /X-Idempotency-Key/.test(all) },
  { area: 'Android Contract', critical: true, name: 'Operation mode is explicit', pass: /operacao/.test(all) },
  { area: 'Emergency Stop', critical: true, name: 'Emergency state exists in Android project', pass: fs.existsSync(path.join(androidRoot, 'EmergencyState.kt')) },
  { area: 'Observability', critical: false, name: 'Command status messages are logged', pass: /console\.log.*command/.test(all) },
  { area: 'Payment Integrity', critical: true, name: 'Mercado Pago webhook/signature protection exists', pass: /MERCADOPAGO_WEBHOOK_SECRET|x-signature|timingSafeEqual/.test(server) },
  { area: 'Input Validation', critical: true, name: 'Command length is bounded', pass: /command\.length>2000/.test(all) },
  { area: 'AI Safety', critical: true, name: 'AI instruction forbids invented data', pass: /não invente dados/i.test(all) },
  { area: 'Planning Safety', critical: true, name: 'Structured action plan has risk levels', pass: /R0/.test(plan) && /R1/.test(plan) && /R2/.test(plan) && /R3/.test(plan) },
  { area: 'Planning Safety', critical: true, name: 'Sensitive actions can require confirmation', pass: /requiresConfirmation/.test(plan) && /R2/.test(plan) },
  { area: 'Android Reliability', critical: true, name: 'Gesture callback is present before claiming gesture completion', pass: /GestureResultCallback/.test(accessibility) },
];

const grouped = new Map();
for (const check of checks) {
  if (!grouped.has(check.area)) grouped.set(check.area, []);
  grouped.get(check.area).push(check);
}
let blocked = false, totalWeight = 0, passedWeight = 0;
for (const [area, areaChecks] of grouped) {
  let areaWeight = 0, areaPassed = 0;
  for (const c of areaChecks) {
    const w = c.critical ? 2 : 1;
    areaWeight += w; totalWeight += w;
    if (c.pass) { areaPassed += w; passedWeight += w; } else if (c.critical) blocked = true;
  }
  const score = areaWeight ? (areaPassed / areaWeight) * 100 : 0;
  console.log(`${score >= 90 ? 'PASS' : 'FAIL'} ${area}: ${score.toFixed(1)}%`);
  for (const c of areaChecks) console.log(`  ${c.pass ? '✓' : '✗'} ${c.name}${c.critical ? ' [CRITICAL]' : ''}`);
}
const global = totalWeight ? (passedWeight / totalWeight) * 100 : 0;
console.log(`GLOBAL EVIDENCE SCORE: ${global.toFixed(1)}%`);
if (blocked || global < 90) {
  console.error('QUALITY GATE: BLOCKED — minimum 90% not proven.');
  process.exit(1);
}
console.log('QUALITY GATE: PASS — minimum 90% proven by configured checks.');

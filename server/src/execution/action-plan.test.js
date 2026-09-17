const assert = require('node:assert/strict');
const { buildPlan, riskFor } = require('./action-plan');

assert.equal(riskFor('home'), 'R0');
assert.equal(riskFor('tap'), 'R1');
assert.equal(riskFor('type_text'), 'R2');
const safe = buildPlan('abrir navegador', [{ action: 'launch_app', target: 'Chrome', verification: { package: 'com.android.chrome' } }]);
assert.equal(safe.risk, 'R1');
assert.equal(safe.requiresConfirmation, false);
const sensitive = buildPlan('preencher campo', [{ action: 'type_text', target: 'email', value: 'x@example.com' }]);
assert.equal(sensitive.risk, 'R2');
assert.equal(sensitive.requiresConfirmation, true);
assert.throws(() => buildPlan('x', [{ action: 'delete_everything' }]));
console.log('action-plan: PASS');

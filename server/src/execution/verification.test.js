const assert = require('node:assert/strict');
const { VERIFICATION, verifyObservation, resultFromActionAndVerification } = require('./verification');

assert.equal(verifyObservation({ packageName: 'com.android.chrome' }, { packageName: 'com.android.chrome' }).status, VERIFICATION.SUCCESS);
assert.equal(verifyObservation({ text: 'Página inicial' }, { text: 'página' }).status, VERIFICATION.SUCCESS);
assert.equal(verifyObservation({ text: 'Outra tela' }, { text: 'Chrome' }).status, VERIFICATION.FAIL);
assert.equal(verifyObservation({}, {}).status, VERIFICATION.UNKNOWN);
assert.equal(resultFromActionAndVerification(false, { status: VERIFICATION.SUCCESS }).status, VERIFICATION.FAIL);
assert.equal(resultFromActionAndVerification(true, null).status, VERIFICATION.UNKNOWN);
console.log('verification: PASS');

const VERIFICATION = Object.freeze({ SUCCESS: 'SUCCESS', FAIL: 'FAIL', UNKNOWN: 'UNKNOWN' });

function normalizeObservation(observation = {}) {
  return {
    packageName: String(observation.packageName || '').trim(),
    text: String(observation.text || '').trim(),
    contentDescription: String(observation.contentDescription || '').trim(),
    resourceId: String(observation.resourceId || '').trim(),
    url: String(observation.url || '').trim(),
    screen: String(observation.screen || '').trim()
  };
}

function verifyObservation(observation, expected = {}) {
  const actual = normalizeObservation(observation);
  const checks = [];
  if (expected.packageName) checks.push(actual.packageName === String(expected.packageName));
  if (expected.text) checks.push(actual.text.toLowerCase().includes(String(expected.text).toLowerCase()));
  if (expected.contentDescription) checks.push(actual.contentDescription.toLowerCase().includes(String(expected.contentDescription).toLowerCase()));
  if (expected.resourceId) checks.push(actual.resourceId === String(expected.resourceId));
  if (expected.url) checks.push(actual.url === String(expected.url));
  if (expected.screen) checks.push(actual.screen === String(expected.screen));
  if (!checks.length) return { status: VERIFICATION.UNKNOWN, reason: 'Nenhuma condição de verificação foi definida.' };
  if (checks.every(Boolean)) return { status: VERIFICATION.SUCCESS, reason: 'Estado observado corresponde ao esperado.' };
  return { status: VERIFICATION.FAIL, reason: 'Estado observado não corresponde ao esperado.' };
}

function resultFromActionAndVerification(actionAccepted, verification) {
  if (!actionAccepted) return { status: VERIFICATION.FAIL, reason: 'A ação não foi aceita pelo sistema.' };
  if (!verification || !verification.status) return { status: VERIFICATION.UNKNOWN, reason: 'A ação foi aceita, mas não houve observação verificável.' };
  return verification;
}

module.exports = { VERIFICATION, normalizeObservation, verifyObservation, resultFromActionAndVerification };

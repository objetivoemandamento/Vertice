const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dashboard = fs.readFileSync(path.join(__dirname, '../../web/index.html'), 'utf8');
const backend = fs.readFileSync(path.join(__dirname, '../src/server.js'), 'utf8');

test('web dashboard contains the office and sales module', () => {
  assert.match(dashboard, /id="office"/);
  assert.match(dashboard, /id="sales"/);
  assert.match(dashboard, /\/ai\/agent\/chat/);
  assert.match(dashboard, /\/ai\/agent\/execute/);
  assert.match(dashboard, /\/admin\/sales\?month=/);
  assert.match(dashboard, /\/sales\?month=/);
});

test('web-first dashboard does not expose APK or Mercado Livre integration', () => {
  assert.doesNotMatch(dashboard, /mercadolivre|mercado livre|download-apk/i);
  assert.doesNotMatch(backend, /download-apk|download\/vertice\.apk/);
});

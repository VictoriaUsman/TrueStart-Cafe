// test/transform/stage.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { getFunnelStage } = require('../../lib/transform/stage');

test('detects TOF from campaign name', () => {
  assert.strictEqual(getFunnelStage('K-TS_UK_TOF_Awareness CBO'), 'TOF');
  assert.strictEqual(getFunnelStage('UK_TOF_Awareness_Evergreen_Discovery'), 'TOF');
});

test('detects MOF from campaign name', () => {
  assert.strictEqual(getFunnelStage('K-TS_UK_MOF_Consideration'), 'MOF');
  assert.strictEqual(getFunnelStage('L_UK_MOF_Traffic_Evergreen_Consideration'), 'MOF');
});

test('detects BOF from campaign name, including hyphenated and suffixed forms', () => {
  assert.strictEqual(getFunnelStage('K-TS_UK_BOF-PROVEN'), 'BOF');
  assert.strictEqual(getFunnelStage('K-TS_UK_BOF_Sales Retargeting'), 'BOF');
  assert.strictEqual(getFunnelStage('Active TrueStart Testing Campaign - BOF'), 'BOF');
});

test('falls back to Other when no marker is present', () => {
  assert.strictEqual(getFunnelStage('ENVU | BA | UK | 190325'), 'Other');
});

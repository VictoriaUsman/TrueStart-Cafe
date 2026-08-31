// test/transform/overview.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildFunnelSplit, buildStatusSpend } = require('../../lib/transform/overview');

function ad(overrides) {
  return { stage: 'BOF', spend: 100, purch: 10, roas: 2, status: 'PROVEN', ...overrides };
}

test('buildFunnelSplit groups by stage in TOF/MOF/BOF order with share of total spend', () => {
  const split = buildFunnelSplit([ad({ stage: 'TOF', spend: 300, purch: 1, roas: 0.1 }), ad({ stage: 'BOF', spend: 700, purch: 10, roas: 2 })]);
  assert.deepStrictEqual(split.map((s) => s.stage), ['TOF', 'MOF', 'BOF']);
  const tof = split.find((s) => s.stage === 'TOF');
  assert.strictEqual(tof.spend, 300);
  assert.strictEqual(tof.share, 0.3);
  const mof = split.find((s) => s.stage === 'MOF');
  assert.strictEqual(mof.spend, 0);
  assert.strictEqual(mof.ads, 0);
});

test('buildFunnelSplit computes stage-level ROAS from spend and purchase value, not an average of per-ad ROAS', () => {
  const split = buildFunnelSplit([
    ad({ stage: 'BOF', spend: 100, val: 300 }),
    ad({ stage: 'BOF', spend: 300, val: 300 }),
  ]);
  const bof = split.find((s) => s.stage === 'BOF');
  assert.strictEqual(bof.roas, 600 / 400);
});

test('buildStatusSpend always includes all five statuses, KILL always zero', () => {
  const spend = buildStatusSpend([ad({ status: 'PROVEN', spend: 100 }), ad({ status: 'Feeder', spend: 50 })]);
  assert.deepStrictEqual(
    spend.map((s) => s.status),
    ['PROVEN', 'TESTING', 'KILL', 'Feeder', 'STARVED']
  );
  const kill = spend.find((s) => s.status === 'KILL');
  assert.strictEqual(kill.count, 0);
  assert.strictEqual(kill.spend, 0);
  const proven = spend.find((s) => s.status === 'PROVEN');
  assert.strictEqual(proven.share, 100 / 150);
});

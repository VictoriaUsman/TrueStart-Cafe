// test/transform/creative-parse.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { parseCreativeName } = require('../../lib/transform/creative-parse');

test('parses a well-formed ad name into all four fields', () => {
  assert.deepStrictEqual(parseCreativeName('BOF_ST_19_Upgrader_Price_Starter_Bags V2'), {
    persona: 'Upgrader',
    angle: 'Price',
    product: 'Starter',
    format: 'Bags',
  });
});

test('parses a name with a UGC-style prefix before persona', () => {
  assert.deepStrictEqual(parseCreativeName('BOF_UGC_Kate_Barista_Quality_Taster_Bags'), {
    persona: 'Barista',
    angle: 'Quality',
    product: 'Taster',
    format: 'Bags',
  });
});

test('falls back to Other for every field when no persona token matches', () => {
  assert.deepStrictEqual(parseCreativeName('TOF_Founder_07_WhereComesFrom_Brand'), {
    persona: 'Other',
    angle: 'Other',
    product: 'Other',
    format: 'Other',
  });
});

test('falls back per-field when only some tokens match known values', () => {
  assert.deepStrictEqual(parseCreativeName('MOF_VID_12 _Upgrader_Easyswap_PDP_Beans'), {
    persona: 'Upgrader',
    angle: 'Other',
    product: 'Other',
    format: 'Beans',
  });
});

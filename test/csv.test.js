// test/csv.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { parseCsv, csvToObjects } = require('../lib/csv');

test('parseCsv splits simple rows and columns', () => {
  const rows = parseCsv('a,b,c\n1,2,3\n');
  assert.deepStrictEqual(rows, [['a', 'b', 'c'], ['1', '2', '3']]);
});

test('parseCsv handles quoted fields containing commas', () => {
  const rows = parseCsv('name,note\n"Smith, Jane",hello\n');
  assert.deepStrictEqual(rows, [['name', 'note'], ['Smith, Jane', 'hello']]);
});

test('parseCsv handles escaped double quotes inside quoted fields', () => {
  const rows = parseCsv('name\n"She said ""hi"""\n');
  assert.deepStrictEqual(rows, [['name'], ['She said "hi"']]);
});

test('parseCsv handles CRLF line endings', () => {
  const rows = parseCsv('a,b\r\n1,2\r\n');
  assert.deepStrictEqual(rows, [['a', 'b'], ['1', '2']]);
});

test('csvToObjects maps rows to header-keyed objects', () => {
  const objs = csvToObjects('name,qty\nCoffee,5\nTea,3\n');
  assert.deepStrictEqual(objs, [
    { name: 'Coffee', qty: '5' },
    { name: 'Tea', qty: '3' },
  ]);
});

test('csvToObjects returns empty array for header-only input', () => {
  assert.deepStrictEqual(csvToObjects('name,qty\n'), []);
});

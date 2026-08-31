// test/sync-creatives.test.js
const { test, mock } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { syncCreativesChunk, chunkDateRange, bandStartRow, CHUNK_COUNT, BAND_SIZE } = require('../api/sync-creatives');

const CREATIVES_TAB_ROW_CAPACITY = 2500;

// The two handler tests below need the real env vars present on process.env. Capture whatever was
// there first so the mutation can be undone — otherwise these tests leak fake credentials into
// every test that runs after them in the same process.
function applyEnv(vars) {
  const previous = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]));
  Object.assign(process.env, vars);
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

function nextDay(date) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

// getAccessToken signs a real JWT with crypto.createSign().sign() before making an HTTP call,
// so the key must be a structurally valid PEM even though the mocked oauth2 endpoint never
// actually verifies the signature — same pattern as test/sync-shopify.test.js.
const { privateKey: FAKE_PRIVATE_KEY } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const ENV = {
  WINDSOR_API_KEY: 'wkey',
  GOOGLE_SHEET_ID: 'SHEET_ID',
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'sheet-writer@example.iam.gserviceaccount.com',
  GOOGLE_SERVICE_ACCOUNT_KEY: FAKE_PRIVATE_KEY,
};

// Hand-verified for ref 2026-09-01: yesterday is 2026-08-31 = epoch day 20696
// (20454 days to 2026-01-01, + 242 days to Aug 31). floor(20696 / 5) = 4139, so chunk 0 owns
// block 4139 = epoch days 20695..20699 = 2026-08-30..2026-09-03, and each higher chunk index
// steps back exactly one 5-day block.
test('chunkDateRange anchors each chunk to a fixed 5-day calendar block, not a relative days-ago offset', () => {
  const ref = new Date('2026-09-01T12:00:00Z');
  assert.deepStrictEqual(chunkDateRange(0, ref), { dateFrom: '2026-08-30', dateTo: '2026-09-03' });
  assert.deepStrictEqual(chunkDateRange(1, ref), { dateFrom: '2026-08-25', dateTo: '2026-08-29' });
  assert.deepStrictEqual(chunkDateRange(2, ref), { dateFrom: '2026-08-20', dateTo: '2026-08-24' });
  assert.deepStrictEqual(chunkDateRange(3, ref), { dateFrom: '2026-08-15', dateTo: '2026-08-19' });
  assert.deepStrictEqual(chunkDateRange(4, ref), { dateFrom: '2026-08-10', dateTo: '2026-08-14' });
  assert.deepStrictEqual(chunkDateRange(5, ref), { dateFrom: '2026-08-05', dateTo: '2026-08-09' });
});

test('the 6 chunk windows tile the calendar with zero overlap and zero gap', () => {
  const ref = new Date('2026-09-01T12:00:00Z');
  for (let chunk = 0; chunk < CHUNK_COUNT - 1; chunk += 1) {
    const newer = chunkDateRange(chunk, ref);
    const older = chunkDateRange(chunk + 1, ref);
    const dayAfterOlderEnd = nextDay(new Date(`${older.dateTo}T00:00:00Z`)).toISOString().slice(0, 10);
    assert.strictEqual(
      newer.dateFrom, dayAfterOlderEnd,
      `chunk ${chunk} must start the day after chunk ${chunk + 1} ends`
    );
  }
});

test('chunkDateRange returns the same window one day later, so a late retry does not drift', () => {
  const ref = new Date('2026-09-01T12:00:00Z');
  assert.deepStrictEqual(chunkDateRange(2, nextDay(ref)), chunkDateRange(2, ref));
});

test('bandStartRow reserves a 400-row band per chunk, starting after the header row', () => {
  assert.strictEqual(bandStartRow(0), 2);
  assert.strictEqual(bandStartRow(1), 402);
  assert.strictEqual(bandStartRow(5), 2002);
});

test('the 6 bands tile the sheet contiguously and fit inside the live tab row capacity', () => {
  for (let chunk = 0; chunk < CHUNK_COUNT - 1; chunk += 1) {
    assert.strictEqual(bandStartRow(chunk) + BAND_SIZE, bandStartRow(chunk + 1));
  }
  assert.ok(
    bandStartRow(CHUNK_COUNT - 1) + BAND_SIZE - 1 <= CREATIVES_TAB_ROW_CAPACITY,
    `last band ends at row ${bandStartRow(CHUNK_COUNT - 1) + BAND_SIZE - 1}, past the tab's ${CREATIVES_TAB_ROW_CAPACITY}-row capacity`
  );
});

const ONE_WINDSOR_AD = [{ ad_name: 'Ad 1', spend: 10, campaign: 'Camp A', adset_name: 'Adset A' }];

function mockAll({ windsorOk = true, sheetsOk = true, windsorData = ONE_WINDSOR_AD } = {}) {
  return mock.fn(async (url, opts) => {
    if (String(url).includes('oauth2.googleapis.com/token')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'tok' }) };
    }
    if (String(url).includes('connectors.windsor.ai')) {
      if (!windsorOk) return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ data: windsorData }) };
    }
    if (String(url).includes('sheets.googleapis.com')) {
      return sheetsOk ? { ok: true, status: 200, json: async () => ({}) } : { ok: false, status: 403, json: async () => ({}) };
    }
    throw new Error(`Unexpected fetch call: ${url}`);
  });
}

test('syncCreativesChunk fetches, aggregates, and writes one chunk\'s band, reporting rows written', async () => {
  const originalFetch = global.fetch;
  global.fetch = mockAll();
  try {
    const result = await syncCreativesChunk(ENV, 2);
    assert.deepStrictEqual(result, { ok: true, rows: 1 });
  } finally {
    global.fetch = originalFetch;
  }
});

test('syncCreativesChunk requests its own chunk\'s date window from Windsor and writes its own band', async () => {
  const originalFetch = global.fetch;
  const fetchMock = mockAll();
  global.fetch = fetchMock;
  try {
    await syncCreativesChunk(ENV, 3);

    const windsorCall = fetchMock.mock.calls.find((c) => String(c.arguments[0]).includes('connectors.windsor.ai'));
    assert.ok(windsorCall, 'expected a Windsor fetch');
    const windsorUrl = new URL(String(windsorCall.arguments[0]));
    const expected = chunkDateRange(3, new Date());
    assert.strictEqual(windsorUrl.pathname, '/facebook');
    assert.strictEqual(windsorUrl.searchParams.get('date_from'), expected.dateFrom);
    assert.strictEqual(windsorUrl.searchParams.get('date_to'), expected.dateTo);
    assert.strictEqual(windsorUrl.searchParams.get('account_id'), '732629205086');

    const putCall = fetchMock.mock.calls.find(
      (c) => String(c.arguments[0]).includes('sheets.googleapis.com') && c.arguments[1] && c.arguments[1].method === 'PUT'
    );
    assert.ok(putCall, 'expected a Sheets values.update PUT');
    assert.strictEqual(bandStartRow(3), 1202);
    assert.ok(
      decodeURIComponent(String(putCall.arguments[0])).includes('/values/Creatives!A1202?'),
      `Sheets PUT targeted the wrong range: ${putCall.arguments[0]}`
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('syncCreativesChunk leaves the band untouched when Windsor returns zero ads', async () => {
  const originalFetch = global.fetch;
  const originalWarn = console.warn;
  const fetchMock = mockAll({ windsorData: [] });
  global.fetch = fetchMock;
  console.warn = () => {};
  try {
    const result = await syncCreativesChunk(ENV, 4);
    assert.deepStrictEqual(result, { ok: true, rows: 0, skipped: 'empty-response' });
    const googleCalls = fetchMock.mock.calls.filter((c) => String(c.arguments[0]).includes('sheets.googleapis.com') || String(c.arguments[0]).includes('oauth2.googleapis.com'));
    assert.strictEqual(googleCalls.length, 0);
  } finally {
    global.fetch = originalFetch;
    console.warn = originalWarn;
  }
});

test('syncCreativesChunk never calls the Sheets API at all when the Windsor fetch fails', async () => {
  const originalFetch = global.fetch;
  const fetchMock = mockAll({ windsorOk: false });
  global.fetch = fetchMock;
  try {
    await assert.rejects(() => syncCreativesChunk(ENV, 0), /Windsor API error \(500\)/);
    const sheetsCalls = fetchMock.mock.calls.filter((c) => String(c.arguments[0]).includes('sheets.googleapis.com') || String(c.arguments[0]).includes('oauth2.googleapis.com'));
    assert.strictEqual(sheetsCalls.length, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test('syncCreativesChunk propagates a descriptive error when the Sheets write fails', async () => {
  const originalFetch = global.fetch;
  global.fetch = mockAll({ sheetsOk: false });
  try {
    await assert.rejects(() => syncCreativesChunk(ENV, 0), /Sheets update failed \(403\)/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('syncCreativesChunk throws a descriptive error naming missing required env vars, before any network call', async () => {
  const originalFetch = global.fetch;
  const fetchMock = mock.fn(async () => { throw new Error('should not be called'); });
  global.fetch = fetchMock;
  try {
    await assert.rejects(
      () => syncCreativesChunk({ WINDSOR_API_KEY: 'k' }, 0),
      /Missing required environment variable\(s\): GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_KEY/
    );
    assert.strictEqual(fetchMock.mock.calls.length, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test('handler rejects requests without the correct CRON_SECRET bearer token', async () => {
  const { default: handler } = require('../api/sync-creatives');
  const originalSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'right-secret';
  const req = { headers: { authorization: 'Bearer wrong-secret' }, query: { chunk: '0' } };
  let statusCode;
  const res = { status(code) { statusCode = code; return this; }, send() { return this; }, json() { return this; } };
  try {
    await handler(req, res);
    assert.strictEqual(statusCode, 401);
  } finally {
    process.env.CRON_SECRET = originalSecret;
  }
});

test('handler fails closed with 500 when CRON_SECRET is not configured', async () => {
  const { default: handler } = require('../api/sync-creatives');
  const originalSecret = process.env.CRON_SECRET;
  const originalFetch = global.fetch;
  delete process.env.CRON_SECRET;
  const fetchMock = mock.fn(async () => { throw new Error('should not be called'); });
  global.fetch = fetchMock;
  try {
    for (const authorization of ['Bearer undefined', 'Bearer anything', '']) {
      let statusCode;
      const req = { headers: { authorization }, query: { chunk: '0' } };
      const res = { status(code) { statusCode = code; return this; }, send() { return this; }, json() { return this; } };
      await handler(req, res);
      assert.strictEqual(statusCode, 500, `authorization=${JSON.stringify(authorization)} should not authenticate`);
    }
    assert.strictEqual(fetchMock.mock.calls.length, 0);
  } finally {
    if (originalSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalSecret;
    global.fetch = originalFetch;
  }
});

test('handler rejects a missing or out-of-range chunk query param with 400, without touching the network', async () => {
  const { default: handler } = require('../api/sync-creatives');
  const originalSecret = process.env.CRON_SECRET;
  const originalFetch = global.fetch;
  process.env.CRON_SECRET = 'right-secret';
  const fetchMock = mock.fn(async () => { throw new Error('should not be called'); });
  global.fetch = fetchMock;
  try {
    for (const chunk of [undefined, '', '  ', '6', '-1', '1.5', '+1', 'not-a-number']) {
      let statusCode, body;
      const req = { headers: { authorization: 'Bearer right-secret' }, query: chunk === undefined ? {} : { chunk } };
      const res = { status(code) { statusCode = code; return this; }, json(b) { body = b; return this; }, send() { return this; } };
      await handler(req, res);
      assert.strictEqual(statusCode, 400, `chunk=${chunk} should be rejected`);
      assert.match(body.error, new RegExp(`integer between 0 and ${CHUNK_COUNT - 1}`));
    }
    assert.strictEqual(fetchMock.mock.calls.length, 0);
  } finally {
    process.env.CRON_SECRET = originalSecret;
    global.fetch = originalFetch;
  }
});

test('handler responds 200 with the sync result for a valid chunk and correct secret', async () => {
  const { default: handler } = require('../api/sync-creatives');
  const originalSecret = process.env.CRON_SECRET;
  const originalFetch = global.fetch;
  process.env.CRON_SECRET = 'right-secret';
  const restoreEnv = applyEnv(ENV);
  global.fetch = mockAll();
  try {
    let statusCode, body;
    const req = { headers: { authorization: 'Bearer right-secret' }, query: { chunk: '3' } };
    const res = { status(code) { statusCode = code; return this; }, json(b) { body = b; return this; }, send() { return this; } };
    await handler(req, res);
    assert.strictEqual(statusCode, 200);
    assert.deepStrictEqual(body, { ok: true, rows: 1 });
  } finally {
    process.env.CRON_SECRET = originalSecret;
    restoreEnv();
    global.fetch = originalFetch;
  }
});

test('handler responds 500 with ok:false when the chunk sync throws', async () => {
  const { default: handler } = require('../api/sync-creatives');
  const originalSecret = process.env.CRON_SECRET;
  const originalFetch = global.fetch;
  process.env.CRON_SECRET = 'right-secret';
  const restoreEnv = applyEnv(ENV);
  global.fetch = mockAll({ windsorOk: false });
  try {
    let statusCode, body;
    const req = { headers: { authorization: 'Bearer right-secret' }, query: { chunk: '0' } };
    const res = { status(code) { statusCode = code; return this; }, json(b) { body = b; return this; }, send() { return this; } };
    await handler(req, res);
    assert.strictEqual(statusCode, 500);
    assert.strictEqual(body.ok, false);
    assert.match(body.error, /Windsor API error \(500\)/);
  } finally {
    process.env.CRON_SECRET = originalSecret;
    restoreEnv();
    global.fetch = originalFetch;
  }
});

const { test, mock } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { getAccessToken } = require('../lib/google-sheets-auth');

// Generate a throwaway RSA keypair once for these tests — no real credentials involved.
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

function b64urlDecode(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

test('getAccessToken builds a valid signed JWT and returns the access token from the response', async () => {
  const originalFetch = global.fetch;
  let capturedBody;
  global.fetch = mock.fn(async (url, opts) => {
    capturedBody = opts.body;
    return { ok: true, status: 200, json: async () => ({ access_token: 'ya29.fake-token' }) };
  });
  try {
    const token = await getAccessToken({ clientEmail: 'sheet-writer@example.iam.gserviceaccount.com', privateKey });
    assert.strictEqual(token, 'ya29.fake-token');

    const params = new URLSearchParams(capturedBody);
    assert.strictEqual(params.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
    const jwt = params.get('assertion');
    const [headerB64, claimB64, sigB64] = jwt.split('.');
    const claim = JSON.parse(b64urlDecode(claimB64));
    assert.strictEqual(claim.iss, 'sheet-writer@example.iam.gserviceaccount.com');
    assert.strictEqual(claim.scope, 'https://www.googleapis.com/auth/spreadsheets');
    assert.strictEqual(claim.aud, 'https://oauth2.googleapis.com/token');

    // Signature must actually verify against the matching public key.
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(`${headerB64}.${claimB64}`);
    const sig = Buffer.from(sigB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    assert.strictEqual(verifier.verify(publicKey, sig), true);
  } finally {
    global.fetch = originalFetch;
  }
});

test('getAccessToken throws a descriptive error when Google rejects the assertion', async () => {
  const originalFetch = global.fetch;
  global.fetch = mock.fn(async () => ({ ok: true, status: 200, json: async () => ({ error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }) }));
  try {
    await assert.rejects(
      () => getAccessToken({ clientEmail: 'x@example.com', privateKey }),
      /Google auth failed: invalid_grant/
    );
  } finally {
    global.fetch = originalFetch;
  }
});

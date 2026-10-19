// Copyright (c) 2026 Nrupal Akolkar. SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    verifyLicenseToken, storeLicense, requiresLicense,
    UNPAID_MODE, BLOCKLIST
} from './license.js';

// Behaviour tests for the licence module. Tokens are signed in-test with a
// TEST-ONLY private key whose public half is the TEST key embedded in
// core/license.js. This key pair is for tests only — never used in
// production issuance and never shipped anywhere else.

const TEST_PRIVATE_JWK = {
    kty: 'EC', crv: 'P-256',
    x: 'ty_kP2zAS2fxy3AKhAgdi7_MMsy4rUxWPbqNiuR3c08',
    y: 'AgeAnftHm4ZVDtJYDutzDMBckUG_tQK_v1cKZ4xUnt4',
    d: '4YVHZjMGAkfHHYG7JTXGI23zPvr-9-N7B2HIz5fGjXU'
};

const KID = '0123456789abcdef0123456789abcdef';
const GOOD_PAYLOAD = { v: 1, product: 'sovereign-core', kid: KID, iat: 1760000000 };

function b64url(bytes) {
    return Buffer.from(bytes).toString('base64url');
}

async function signToken(payloadObj) {
    const segment = b64url(new TextEncoder().encode(JSON.stringify(payloadObj)));
    const key = await globalThis.crypto.subtle.importKey(
        'jwk', TEST_PRIVATE_JWK, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    const sig = await globalThis.crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(segment));
    return segment + '.' + b64url(new Uint8Array(sig));
}

test('a valid token verifies and returns its payload', async () => {
    const token = await signToken(GOOD_PAYLOAD);
    const payload = await verifyLicenseToken(token);
    assert.deepEqual(payload, GOOD_PAYLOAD);
});

test('a tampered payload is rejected', async () => {
    const token = await signToken(GOOD_PAYLOAD);
    const sigSegment = token.split('.')[1];
    const forgedSegment = b64url(new TextEncoder().encode(
        JSON.stringify({ ...GOOD_PAYLOAD, iat: GOOD_PAYLOAD.iat + 1000 })));
    assert.equal(await verifyLicenseToken(forgedSegment + '.' + sigSegment), null);
});

test('a tampered signature is rejected', async () => {
    const token = await signToken(GOOD_PAYLOAD);
    const [seg, sig] = token.split('.');
    const sigBytes = Buffer.from(sig, 'base64url');
    sigBytes[0] ^= 0xff;
    assert.equal(await verifyLicenseToken(seg + '.' + sigBytes.toString('base64url')), null);
});

test('garbage tokens are rejected with null and never throw', async () => {
    for (const junk of ['', 'abc', 'a.b.c', '!!!.???', '.', 'x.', null, undefined, 42, {}]) {
        assert.equal(await verifyLicenseToken(junk), null, `expected null for ${String(junk)}`);
    }
    // well-formed base64url but not JSON
    const notJson = b64url(new TextEncoder().encode('hello')) + '.' + b64url(new Uint8Array(64));
    assert.equal(await verifyLicenseToken(notJson), null);
});

test('a token for the wrong product is rejected even when validly signed', async () => {
    const token = await signToken({ ...GOOD_PAYLOAD, product: 'vault-tracker' });
    assert.equal(await verifyLicenseToken(token), null);
});

test('malformed payload fields are rejected', async () => {
    assert.equal(await verifyLicenseToken(await signToken({ ...GOOD_PAYLOAD, v: 2 })), null);
    assert.equal(await verifyLicenseToken(await signToken({ ...GOOD_PAYLOAD, kid: 'xyz' })), null);
    assert.equal(await verifyLicenseToken(await signToken({ ...GOOD_PAYLOAD, iat: 'now' })), null);
});

test('a blocklisted kid is rejected', async () => {
    const token = await signToken(GOOD_PAYLOAD);
    assert.notEqual(await verifyLicenseToken(token), null); // valid before listing
    BLOCKLIST.push(KID);
    try {
        assert.equal(await verifyLicenseToken(token), null);
    } finally {
        BLOCKLIST.splice(BLOCKLIST.indexOf(KID), 1);
    }
});

test('storeLicense refuses an invalid token (verify gate runs before storage)', async () => {
    assert.equal(await storeLicense('not-a-token'), false);
    assert.equal(await storeLicense(await signToken({ ...GOOD_PAYLOAD, product: 'other' })), false);
});

test('requiresLicense: user data is never gated (shipped activation-required mode)', () => {
    assert.equal(UNPAID_MODE, 'activation-required'); // pins the shipped config this matrix is stated for
    assert.equal(requiresLicense('open-vault'), false);
    assert.equal(requiresLicense('export'), false);
    assert.equal(requiresLicense('create-vault'), true);
    assert.equal(requiresLicense('something-unknown'), false);
});

test("requiresLicense: in 'open' mode nothing is gated (constant flipped on a copy of the module)", async () => {
    // Load a copy of the real module source with only the UNPAID_MODE
    // constant flipped, so the 'open' shape is exercised through the same
    // code path rather than a re-implementation.
    const src = await readFile(new URL('./license.js', import.meta.url), 'utf8');
    assert.ok(src.includes("export const UNPAID_MODE = 'activation-required'"));
    const flipped = src
        .replace("export const UNPAID_MODE = 'activation-required'", "export const UNPAID_MODE = 'open'")
        .replace("from './db.js'", `from '${new URL('./db.js', import.meta.url).href}'`);
    const tmp = join(tmpdir(), `license-open-${process.pid}.mjs`);
    await writeFile(tmp, flipped);
    try {
        const mod = await import(pathToFileURL(tmp).href);
        assert.equal(mod.UNPAID_MODE, 'open');
        assert.equal(mod.requiresLicense('create-vault'), false);
        assert.equal(mod.requiresLicense('open-vault'), false);
        assert.equal(mod.requiresLicense('export'), false);
    } finally {
        await rm(tmp, { force: true });
    }
});

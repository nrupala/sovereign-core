// Copyright (c) 2026 Nrupal Akolkar. SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVerifier, verifyPassword } from './crypto.js';

// Regression suite for the Phase 0 verifier defect (assessment F-01/F-02):
// verifyPassword() previously fell back to a self-test encrypt/decrypt with
// the candidate key whenever verifier decryption failed, so EVERY password —
// including a wrong or empty one — verified as correct. Vault unlock opened
// an empty view and vault DELETE was effectively unauthenticated.
// These tests fail on the pre-fix code and must pass after it.

const PASSWORD = 'correct horse battery staple';
const salt = new Uint8Array(16).map((_, i) => i + 1);

test('verifyPassword accepts the correct password', async () => {
    const verifier = await createVerifier(PASSWORD, salt);
    assert.equal(await verifyPassword(PASSWORD, salt, verifier), true);
});

test('verifyPassword rejects a wrong password', async () => {
    const verifier = await createVerifier(PASSWORD, salt);
    assert.equal(await verifyPassword('wrong password', salt, verifier), false);
});

test('verifyPassword rejects an empty password', async () => {
    const verifier = await createVerifier(PASSWORD, salt);
    assert.equal(await verifyPassword('', salt, verifier), false);
});

test('verifyPassword fails closed when the verifier is missing', async () => {
    assert.equal(await verifyPassword(PASSWORD, salt, null), false);
    assert.equal(await verifyPassword(PASSWORD, salt, undefined), false);
    assert.equal(await verifyPassword(PASSWORD, salt, {}), false);
});

test('verifyPassword rejects a tampered verifier', async () => {
    const verifier = await createVerifier(PASSWORD, salt);
    const ct = new Uint8Array(verifier.ciphertext.slice(0));
    ct[0] ^= 0xff; // flip bits in the first ciphertext byte
    const tampered = { ciphertext: ct.buffer, iv: verifier.iv };
    assert.equal(await verifyPassword(PASSWORD, salt, tampered), false);
});

test('verifyPassword rejects the right password against the wrong salt', async () => {
    const verifier = await createVerifier(PASSWORD, salt);
    const otherSalt = new Uint8Array(16).map((_, i) => i + 101);
    assert.equal(await verifyPassword(PASSWORD, otherSalt, verifier), false);
});

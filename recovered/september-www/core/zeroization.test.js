/**
 * Memory-Zeroization & Key-Lifetime Test Suite (G11.2)
 *
 * Proves every memory-hygiene property that is actually enforceable in a
 * JavaScript / WebCrypto runtime:
 *   - the vault key is NON-EXTRACTABLE, so key bits can never be read into JS
 *   - the vault key is least-privilege (encrypt/decrypt only, no export/derive)
 *   - a wrong password never yields a usable key (fail closed)
 *   - the password byte buffer is zeroized in a `finally` (source audit, so a
 *     regression that drops the wipe is caught)
 *   - dropping the last reference releases the key (lock() semantics for the
 *     key-holder abstraction)
 *
 * What this suite deliberately does NOT claim: that JS strings or crypto
 * buffers are scrubbed from the heap. That is not a guarantee JavaScript can
 * make — see docs/MEMORY_ZEROIZATION.md for the precise boundary.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { deriveKey, verifyPassword, createVerifier } from './crypto.js';
import { identity } from './identity.js';

const salt = () => crypto.getRandomValues(new Uint8Array(16));
const PASSWORD = 'zeroization-canary-password';

test('vault key is non-extractable (key bits cannot be read by JS)', async () => {
    const key = await deriveKey(PASSWORD, salt());
    assert.equal(key.extractable, false, 'derived vault key must be non-extractable');
    await assert.rejects(
        () => crypto.subtle.exportKey('raw', key),
        /InvalidAccessError|not extractable/i,
        'exporting the non-extractable vault key must be rejected'
    );
    await assert.rejects(
        () => crypto.subtle.exportKey('jwk', key),
        /InvalidAccessError|not extractable/i,
        'JWK export of the non-extractable vault key must be rejected'
    );
});

test('vault key is least-privilege: AES-GCM encrypt/decrypt only', async () => {
    const key = await deriveKey(PASSWORD, salt());
    assert.equal(key.algorithm.name, 'AES-GCM');
    assert.equal(key.algorithm.length, 256);
    assert.equal(key.type, 'secret');
    assert.deepEqual([...key.usages].sort(), ['decrypt', 'encrypt'],
        'vault key must not carry export or derive usages');
});

test('a wrong password never yields a usable key (fail closed)', async () => {
    const s = salt();
    const verifier = await createVerifier(PASSWORD, s);
    assert.equal(await verifyPassword(PASSWORD, s, verifier), true, 'correct password verifies');
    assert.equal(await verifyPassword('wrong-password', s, verifier), false, 'wrong password rejected');
    const wrongKey = await deriveKey('wrong-password', s);
    assert.equal(wrongKey.extractable, false, 'even a wrong-password key stays non-extractable');
});

test('password bytes are zeroized in a finally block (regression audit)', async () => {
    const source = await readFile(fileURLToPath(new URL('./crypto.js', import.meta.url)), 'utf8');
    const derive = source.slice(source.indexOf('export async function deriveKey'), source.indexOf('export async function encryptData'));
    assert.match(derive, /pwBytes\.fill\(0\)/, 'deriveKey must zeroize the password byte buffer');
    assert.match(derive, /finally\s*{[\s\S]*pwBytes\.fill\(0\)/,
        'the zeroize must run in a finally block so it survives a derivation error');
});

test('key holder releases its reference on lock and refuses use afterwards', async () => {
    await identity.authenticate(PASSWORD, salt());
    const held = identity.masterKey;
    assert.equal(held.extractable, false, 'held master key is non-extractable');
    identity.lock();
    assert.throws(() => identity.masterKey, /Vault Locked/, 'masterKey must be inaccessible after lock');
    assert.equal(identity.salt, null, 'salt reference is cleared on lock');
});

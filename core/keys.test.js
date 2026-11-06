// Copyright (c) 2026 2351485 ALBERTA INC. SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptData, decryptData } from './crypto.js';
import {
    createEnvelope, unlockWithPassword, unlockWithRecoveryKey,
    changePassword, recoverWithNewPassword,
    unwrapDEKBytes, encodeRecoveryKey, decodeRecoveryKey
} from './keys.js';

// Phase 1 spec §3 / §8 acceptance tests for the envelope key architecture:
// wrap/unwrap round-trips; wrong password fails closed; wrong recovery key
// fails closed; recovery → new password → unlock with the new password and
// NOT the old; password change re-wraps the SAME DEK (items never
// re-encrypted). Same fail-closed discipline as the Phase 0 verifier suite.

const PASSWORD = 'correct horse battery staple';
const NEW_PASSWORD = 'a brand new passphrase';

test('envelope creation + password unlock round-trips item encryption', async () => {
    const { envelope, dek, recoveryKey } = await createEnvelope(PASSWORD);
    assert.equal(envelope.formatVersion, 2);
    assert.ok(envelope.passwordWrap.ciphertext.length > 0);
    assert.ok(envelope.recoveryWrap.ciphertext.length > 0);
    assert.ok(envelope.verifier.ciphertext.length > 0);
    assert.equal(typeof recoveryKey, 'string');

    const { ciphertext, iv } = await encryptData(dek, 'journal entry, sealed');
    const unlocked = await unlockWithPassword(envelope, PASSWORD);
    assert.ok(unlocked, 'unlock with the correct password returns a key');
    assert.equal(await decryptData(unlocked, ciphertext, iv), 'journal entry, sealed');
});

test('wrong password fails closed', async () => {
    const { envelope } = await createEnvelope(PASSWORD);
    assert.equal(await unlockWithPassword(envelope, 'wrong password'), null);
    assert.equal(await unlockWithPassword(envelope, ''), null);
    assert.equal(await unwrapDEKBytes(envelope, 'wrong password'), null);
});

test('wrong or malformed recovery key fails closed', async () => {
    const { envelope } = await createEnvelope(PASSWORD);
    const other = await createEnvelope('some other password');
    // A well-formed recovery key for a DIFFERENT vault must not unwrap.
    assert.equal(await unlockWithRecoveryKey(envelope, other.recoveryKey), null);
    // Garbage and truncated input must not unwrap.
    assert.equal(await unlockWithRecoveryKey(envelope, 'not a recovery key'), null);
    assert.equal(await unlockWithRecoveryKey(envelope, ''), null);
    assert.equal(await unlockWithRecoveryKey(envelope, null), null);
});

test('recovery key encoding round-trips and catches transcription errors', async () => {
    const { recoveryKey } = await createEnvelope(PASSWORD);
    const bytes = await decodeRecoveryKey(recoveryKey);
    assert.ok(bytes && bytes.length === 32);
    assert.equal(await encodeRecoveryKey(bytes), recoveryKey);
    // Case/whitespace/grouping tolerant on entry.
    const messy = '  ' + recoveryKey.toLowerCase().replace(/-/g, ' ') + ' ';
    assert.deepEqual(await decodeRecoveryKey(messy), bytes);
    // A single flipped character breaks the checksum — fail closed.
    const chars = recoveryKey.split('');
    chars[5] = chars[5] === 'A' ? 'B' : 'A';
    assert.equal(await decodeRecoveryKey(chars.join('')), null);
});

test('recovery unwraps the same DEK, and recovery + new password re-wraps it', async () => {
    const { envelope, dek, recoveryKey } = await createEnvelope(PASSWORD);
    const { ciphertext, iv } = await encryptData(dek, 'recover me');

    // The recovery door opens the same vault content.
    const viaRecovery = await unlockWithRecoveryKey(envelope, recoveryKey);
    assert.ok(viaRecovery);
    assert.equal(await decryptData(viaRecovery, ciphertext, iv), 'recover me');

    // Recovery sets a NEW password: new password works, old password is dead,
    // the data (encrypted under the unchanged DEK) still opens, and the same
    // recovery key still works against the re-wrapped envelope.
    const recovered = await recoverWithNewPassword(envelope, recoveryKey, NEW_PASSWORD);
    assert.ok(recovered);
    const viaNew = await unlockWithPassword(recovered, NEW_PASSWORD);
    assert.ok(viaNew);
    assert.equal(await decryptData(viaNew, ciphertext, iv), 'recover me');
    assert.equal(await unlockWithPassword(recovered, PASSWORD), null);
    const viaRecoveryAfter = await unlockWithRecoveryKey(recovered, recoveryKey);
    assert.ok(viaRecoveryAfter);
    assert.equal(await decryptData(viaRecoveryAfter, ciphertext, iv), 'recover me');

    // Recovery with a wrong key changes nothing and returns null.
    assert.equal(await recoverWithNewPassword(envelope, 'AAAA-AAAA-AAAA', NEW_PASSWORD), null);
});

test('password change re-wraps the SAME DEK (raw bytes identical)', async () => {
    const { envelope } = await createEnvelope(PASSWORD);
    const before = await unwrapDEKBytes(envelope, PASSWORD);
    assert.ok(before && before.length === 32);

    const changed = await changePassword(envelope, PASSWORD, NEW_PASSWORD);
    assert.ok(changed);
    const after = await unwrapDEKBytes(changed, NEW_PASSWORD);
    assert.deepEqual(after, before, 'DEK bytes are identical across a password change');
    before.fill(0); after.fill(0);

    // New password unlocks, old password is dead, wrong current password
    // cannot authorize a change.
    assert.ok(await unlockWithPassword(changed, NEW_PASSWORD));
    assert.equal(await unlockWithPassword(changed, PASSWORD), null);
    assert.equal(await changePassword(envelope, 'not the password', NEW_PASSWORD), null);
});

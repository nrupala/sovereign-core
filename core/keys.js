// Copyright (c) 2026 2351485 ALBERTA INC. SPDX-License-Identifier: MIT
/**
 * Sovereign Core — Phase 1 envelope keys (spec §3).
 *
 * Each vault gets a random 256-bit Data Encryption Key (DEK) at creation.
 * Items are encrypted under the DEK (AES-256-GCM). The DEK is never stored
 * in the clear; it is wrapped (AES-GCM-encrypted) twice, under two
 * independent Key Encryption Keys:
 *
 *   - Password wrap: KEK derived from the vault password via
 *     core/crypto.js deriveKey (PBKDF2-HMAC-SHA256, 600,000 iterations —
 *     parameters unchanged from v1). The v1 challenge-verifier is retained
 *     against the same derived key, so Phase 0 unlock semantics carry over.
 *   - Recovery wrap: KEK is the one-time recovery key itself — 256 bits of
 *     fresh randomness, imported directly as an AES-GCM key (a uniformly
 *     random 256-bit key needs no KDF; PBKDF2 exists for low-entropy
 *     passwords). Shown ONCE at creation in grouped, checksummed form.
 *
 * Unlock = derive KEK, unwrap DEK. AES-GCM authentication failure means
 * the password / recovery key is wrong: every entry point FAILS CLOSED
 * (returns null), exactly as the Phase 0 verifier fix established.
 * Password change and recovery both re-wrap the SAME DEK — item data is
 * never re-encrypted. If password and recovery key are both lost, the
 * vault is unrecoverable; there is no backdoor, by design.
 *
 * Hygiene: the DEK is imported NON-EXTRACTABLE after unwrap; raw DEK bytes
 * are zeroized immediately after wrapping/import. The one exception is
 * unwrapDEKBytes(), which returns raw bytes for migration/backup internals
 * and tests — callers MUST zeroize the returned array.
 */

import { deriveKey, createVerifier } from './crypto.js';

const ENVELOPE_VERSION = 2;
const SALT_BYTES = 16;
const RECOVERY_KEY_BYTES = 32;
const CHECKSUM_BYTES = 2;

/* ── byte helpers (envelopes are JSON-safe: plain arrays, as db.js stores) ── */

function bytesToArray(buf) {
    return Array.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf));
}

function arrayToBytes(arr) {
    return new Uint8Array(arr);
}

async function wrapDEK(kek, dekBytes) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, kek, dekBytes);
    return { ciphertext: bytesToArray(ct), iv: bytesToArray(iv) };
}

async function unwrapDEKBytesWithKEK(kek, wrap) {
    if (!wrap || !wrap.ciphertext || !wrap.iv) return null;
    try {
        const pt = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: arrayToBytes(wrap.iv) },
            kek,
            arrayToBytes(wrap.ciphertext)
        );
        return new Uint8Array(pt);
    } catch {
        return null; // GCM authentication failure — fail closed.
    }
}

async function importDEK(dekBytes) {
    return crypto.subtle.importKey(
        "raw", dekBytes, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
    );
}

async function passwordKEK(password, salt) {
    // Same derivation as v1 (crypto.js deriveKey): PBKDF2-HMAC-SHA256, 600k.
    return deriveKey(password, salt);
}

async function recoveryKEK(recoveryKeyBytes) {
    return crypto.subtle.importKey(
        "raw", recoveryKeyBytes, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
    );
}

async function makeVerifier(password, salt) {
    const v = await createVerifier(password, salt);
    return { ciphertext: bytesToArray(v.ciphertext), iv: bytesToArray(v.iv) };
}

/* ── recovery key encoding: base32, grouped, checksummed ── */

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(bytes) {
    let out = '';
    let acc = 0, bits = 0;
    for (const b of bytes) {
        acc = (acc << 8) | b;
        bits += 8;
        while (bits >= 5) {
            out += B32_ALPHABET[(acc >> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) out += B32_ALPHABET[(acc << (5 - bits)) & 31];
    return out;
}

function base32Decode(str) {
    const bytes = [];
    let acc = 0, bits = 0;
    for (const ch of str) {
        const v = B32_ALPHABET.indexOf(ch);
        if (v === -1) return null;
        acc = (acc << 5) | v;
        bits += 5;
        if (bits >= 8) {
            bytes.push((acc >> (bits - 8)) & 0xff);
            bits -= 8;
        }
    }
    return new Uint8Array(bytes);
}

async function checksumOf(keyBytes) {
    const digest = await crypto.subtle.digest("SHA-256", keyBytes);
    return new Uint8Array(digest).slice(0, CHECKSUM_BYTES);
}

/**
 * Encode raw recovery-key bytes as the human-readable recovery key:
 * grouped blocks of 4 base32 characters, carrying a 2-byte SHA-256
 * checksum so a transcription error is caught at entry, not at unwrap.
 */
export async function encodeRecoveryKey(keyBytes) {
    if (!keyBytes || keyBytes.length !== RECOVERY_KEY_BYTES) return null;
    const payload = new Uint8Array(RECOVERY_KEY_BYTES + CHECKSUM_BYTES);
    payload.set(keyBytes, 0);
    payload.set(await checksumOf(keyBytes), RECOVERY_KEY_BYTES);
    const b32 = base32Encode(payload);
    return b32.match(/.{1,4}/g).join('-');
}

/**
 * Decode a recovery key entered by the user. Accepts any grouping,
 * whitespace, and case. Returns the raw 32 bytes, or null if the key is
 * malformed or the checksum does not match — fail closed.
 */
export async function decodeRecoveryKey(text) {
    try {
        if (typeof text !== 'string') return null;
        const clean = text.toUpperCase().replace(/[^A-Z2-7]/g, '');
        const payload = base32Decode(clean);
        if (!payload || payload.length !== RECOVERY_KEY_BYTES + CHECKSUM_BYTES) return null;
        const keyBytes = payload.slice(0, RECOVERY_KEY_BYTES);
        const expected = await checksumOf(keyBytes);
        const actual = payload.slice(RECOVERY_KEY_BYTES);
        if (expected[0] !== actual[0] || expected[1] !== actual[1]) return null;
        return keyBytes;
    } catch {
        return null;
    }
}

/* ── envelope lifecycle ── */

/**
 * Create a new vault envelope (spec §3, §5 vault record minus id/name).
 * Returns { envelope, dek, recoveryKey }:
 *   - envelope: JSON-safe record (salt, kdf params, both wraps, verifier).
 *   - dek: non-extractable CryptoKey for the session.
 *   - recoveryKey: the grouped string to show ONCE in the save-it flow.
 */
export async function createEnvelope(password) {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const recoveryKeyBytes = crypto.getRandomValues(new Uint8Array(RECOVERY_KEY_BYTES));

    const extractableDEK = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]
    );
    const dekBytes = new Uint8Array(await crypto.subtle.exportKey("raw", extractableDEK));

    try {
        const pwKEK = await passwordKEK(password, salt);
        const recKEK = await recoveryKEK(recoveryKeyBytes);
        const envelope = {
            formatVersion: ENVELOPE_VERSION,
            salt: bytesToArray(salt),
            kdf: { name: "PBKDF2", hash: "SHA-256", iterations: 600000 },
            passwordWrap: await wrapDEK(pwKEK, dekBytes),
            recoveryWrap: await wrapDEK(recKEK, dekBytes),
            verifier: await makeVerifier(password, salt),
            createdAt: Date.now()
        };
        const dek = await importDEK(dekBytes);
        const recoveryKey = await encodeRecoveryKey(recoveryKeyBytes);
        return { envelope, dek, recoveryKey };
    } finally {
        dekBytes.fill(0);
        recoveryKeyBytes.fill(0);
    }
}

/**
 * Raw DEK bytes from an envelope + password, or null (fail closed).
 * WARNING: raw key material — callers MUST zeroize the returned array.
 * Exists for migration/backup internals and tests; normal unlock should
 * use unlockWithPassword(), which returns a non-extractable key.
 */
export async function unwrapDEKBytes(envelope, password) {
    if (!envelope || !envelope.salt || !envelope.passwordWrap) return null;
    const kek = await passwordKEK(password, arrayToBytes(envelope.salt));
    return unwrapDEKBytesWithKEK(kek, envelope.passwordWrap);
}

/**
 * Unlock with the vault password. Returns the non-extractable DEK,
 * or null if the password is wrong — fail closed.
 */
export async function unlockWithPassword(envelope, password) {
    const dekBytes = await unwrapDEKBytes(envelope, password);
    if (!dekBytes) return null;
    try {
        return await importDEK(dekBytes);
    } finally {
        dekBytes.fill(0);
    }
}

/**
 * Unlock with the one-time recovery key. Returns the non-extractable DEK,
 * or null if the recovery key is malformed, checksummed-wrong, or simply
 * wrong — fail closed.
 */
export async function unlockWithRecoveryKey(envelope, recoveryKeyText) {
    if (!envelope || !envelope.recoveryWrap) return null;
    const keyBytes = await decodeRecoveryKey(recoveryKeyText);
    if (!keyBytes) return null;
    try {
        const kek = await recoveryKEK(keyBytes);
        const dekBytes = await unwrapDEKBytesWithKEK(kek, envelope.recoveryWrap);
        if (!dekBytes) return null;
        try {
            return await importDEK(dekBytes);
        } finally {
            dekBytes.fill(0);
        }
    } finally {
        keyBytes.fill(0);
    }
}

async function rewrapForPassword(envelope, dekBytes, newPassword) {
    const salt = arrayToBytes(envelope.salt);
    const pwKEK = await passwordKEK(newPassword, salt);
    return {
        ...envelope,
        passwordWrap: await wrapDEK(pwKEK, dekBytes),
        verifier: await makeVerifier(newPassword, salt)
    };
}

/**
 * Change the vault password: verify the current password by unwrapping,
 * then re-wrap the SAME DEK under the new password. Items are not
 * re-encrypted. Returns the new envelope, or null if the current
 * password is wrong — fail closed. The recovery wrap is untouched.
 */
export async function changePassword(envelope, currentPassword, newPassword) {
    const dekBytes = await unwrapDEKBytes(envelope, currentPassword);
    if (!dekBytes) return null;
    try {
        return await rewrapForPassword(envelope, dekBytes, newPassword);
    } finally {
        dekBytes.fill(0);
    }
}

/**
 * Forgotten-password recovery: unwrap via the recovery wrap, then re-wrap
 * the SAME DEK under a NEW password. Returns the new envelope, or null if
 * the recovery key is wrong — fail closed. The recovery wrap is untouched,
 * so the same recovery key keeps working after recovery.
 */
export async function recoverWithNewPassword(envelope, recoveryKeyText, newPassword) {
    if (!envelope || !envelope.recoveryWrap) return null;
    const keyBytes = await decodeRecoveryKey(recoveryKeyText);
    if (!keyBytes) return null;
    let dekBytes = null;
    try {
        const kek = await recoveryKEK(keyBytes);
        dekBytes = await unwrapDEKBytesWithKEK(kek, envelope.recoveryWrap);
        if (!dekBytes) return null;
        return await rewrapForPassword(envelope, dekBytes, newPassword);
    } finally {
        keyBytes.fill(0);
        if (dekBytes) dekBytes.fill(0);
    }
}

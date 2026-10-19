// Copyright (c) 2026 Nrupal Akolkar. SPDX-License-Identifier: MIT
/**
 * Sovereign Core v2.0 - Licence Module
 *
 * Offline licence tokens issued by the billing side (Stripe checkout ->
 * issuer signs a token -> buyer pastes it here). A token is
 *   base64url(JSON payload) + "." + base64url(signature)
 * where the signature is ECDSA P-256 / SHA-256 (WebCrypto, raw r||s) over
 * the payload segment's ASCII bytes. Verification is fully local: no
 * network call, no account, no telemetry — consistent with the product's
 * local-only posture.
 *
 * Binding principle: the licence NEVER gates the user's own data.
 * Opening/unlocking an existing vault and exporting are always free;
 * only creating a NEW vault can require activation (see requiresLicense).
 */

import { getSetting, setSetting } from './db.js';

// TEST KEY — production public key is swapped in at billing deploy.
// The matching private key lives only on the issuer side, never in this repo.
export const LICENSE_PUBLIC_JWK = {
    kty: 'EC',
    crv: 'P-256',
    x: 'ty_kP2zAS2fxy3AKhAgdi7_MMsy4rUxWPbqNiuR3c08',
    y: 'AgeAnftHm4ZVDtJYDutzDMBckUG_tQK_v1cKZ4xUnt4'
};

// Revoked licence ids (payload.kid). Updated per release from the issuer's
// published blocklist; a token whose kid appears here never verifies.
export const BLOCKLIST = [];

// CONFIG SWITCH — the owner decides the unpaid-state shape:
//   'activation-required'  creating a vault requires a valid licence
//   'open'                 no gate anywhere
// Behaviour everywhere reads this constant; nothing hard-codes the shape.
export const UNPAID_MODE = 'activation-required';

// Stripe Payment Link for the one-time purchase (US$49.99).
export const BUY_URL = 'https://buy.stripe.com/5kQ3cvc0GbEIbT9bz89Zm05';

const PRODUCT = 'sovereign-core';
const SETTING_KEY = 'license';
const KID_RE = /^[0-9a-f]{32}$/i;

let _publicKeyPromise = null;
function _publicKey() {
    if (!_publicKeyPromise) {
        _publicKeyPromise = globalThis.crypto.subtle.importKey(
            'jwk', LICENSE_PUBLIC_JWK,
            { name: 'ECDSA', namedCurve: 'P-256' },
            false, ['verify']
        );
    }
    return _publicKeyPromise;
}

function _b64urlToBytes(segment) {
    const b64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const bin = atob(padded); // throws on non-base64 input — callers catch
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

/**
 * Verify a licence token. Returns the payload object on success, null on
 * ANY failure (malformed, wrong product/version, bad kid/iat shape,
 * blocklisted kid, bad signature). Fails closed; never throws.
 */
export async function verifyLicenseToken(token) {
    try {
        if (typeof token !== 'string') return null;
        const parts = token.trim().split('.');
        if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

        const payload = JSON.parse(new TextDecoder().decode(_b64urlToBytes(parts[0])));
        if (!payload || typeof payload !== 'object') return null;
        if (payload.v !== 1) return null;
        if (payload.product !== PRODUCT) return null;
        if (typeof payload.kid !== 'string' || !KID_RE.test(payload.kid)) return null;
        if (typeof payload.iat !== 'number' || !Number.isFinite(payload.iat)) return null;
        if (BLOCKLIST.some(k => String(k).toLowerCase() === payload.kid.toLowerCase())) return null;

        const key = await _publicKey();
        const ok = await globalThis.crypto.subtle.verify(
            { name: 'ECDSA', hash: 'SHA-256' },
            key,
            _b64urlToBytes(parts[1]),
            new TextEncoder().encode(parts[0]) // signature covers the payload segment's ASCII bytes
        );
        return ok ? payload : null;
    } catch {
        return null;
    }
}

/* ── Storage (per-app settings, via core/db.js) ── */

export async function getStoredLicense() {
    const value = await getSetting(SETTING_KEY);
    return (typeof value === 'string' && value) ? value : null;
}

/** Verify first; store only a valid token. Returns true iff stored. */
export async function storeLicense(token) {
    const payload = await verifyLicenseToken(token);
    if (!payload) return false;
    await setSetting(SETTING_KEY, token.trim());
    return true;
}

export async function clearLicense() {
    await setSetting(SETTING_KEY, null);
}

export async function hasValidLicense() {
    const token = await getStoredLicense();
    if (!token) return false;
    return (await verifyLicenseToken(token)) !== null;
}

/**
 * Pure gate decision: does this action require a licence at all?
 * The caller composes with hasValidLicense() for the full check.
 * 'open-vault' and 'export' ALWAYS return false — the licence never gates
 * the user's own data, in either unpaid mode.
 */
export function requiresLicense(action) {
    switch (action) {
        case 'open-vault':
        case 'export':
            return false;
        case 'create-vault':
            return UNPAID_MODE === 'activation-required';
        default:
            return false;
    }
}

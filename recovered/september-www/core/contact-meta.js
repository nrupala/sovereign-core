/**
 * Sovereign Core v2.0 - Encrypted Contact Metadata
 * ZT/ZK-compliant contact metadata storage.
 * All PII fields encrypted at rest with the vault key (AES-256-GCM).
 * Decrypted in-memory only for UI display/search; never transmitted; never logged.
 *
 * Schema:
 * {
 *   phone: { value: string, label: string }[],
 *   email: { value: string, label: string }[],
 *   address: { value: string, label: string }[],
 *   organization: { value: string, label: string }[],
 *   notes: string,
 *   photo: string (base64),
 *   groups: string[],
 *   labels: string[]
 * }
 */

import { encryptData, decryptData } from './chat-db.js';

/**
 * Encrypt contact metadata blob with vault key.
 * Returns { ciphertext: [...], iv: [...] } ready for storage.
 */
export async function encryptContactMeta(vaultKey, meta) {
    const plaintext = JSON.stringify(meta);
    return encryptData(vaultKey, plaintext);
}

/**
 * Decrypt contact metadata blob with vault key.
 * Returns the parsed metadata object.
 */
export async function decryptContactMeta(vaultKey, encrypted) {
    if (!encrypted || !encrypted.ciphertext || !encrypted.iv) return null;
    try {
        const plaintext = await decryptData(vaultKey, new Uint8Array(encrypted.ciphertext), new Uint8Array(encrypted.iv));
        return JSON.parse(plaintext);
    } catch {
        return null;
    }
}

/**
 * Build a metadata envelope for storage: { ciphertext, iv, version }.
 */
export async function sealContactMeta(vaultKey, meta) {
    const { ciphertext, iv } = await encryptContactMeta(vaultKey, meta);
    return {
        ciphertext: Array.from(new Uint8Array(ciphertext)),
        iv: Array.from(iv),
        version: 1
    };
}

/**
 * Open a metadata envelope: returns the parsed metadata or null.
 */
export async function openContactMeta(vaultKey, sealed) {
    if (!sealed || !sealed.ciphertext || !sealed.iv) return null;
    return decryptContactMeta(vaultKey, { ciphertext: sealed.ciphertext, iv: sealed.iv });
}

/**
 * Validate a metadata object before sealing.
 * Returns { valid: true } or { valid: false, error: string }.
 */
export function validateContactMeta(meta) {
    if (!meta || typeof meta !== 'object') return { valid: false, error: 'metadata must be an object' };

    const allowedKeys = new Set(['phone', 'email', 'address', 'organization', 'notes', 'photo', 'groups', 'labels']);
    for (const key of Object.keys(meta)) {
        if (!allowedKeys.has(key)) return { valid: false, error: `disallowed key: ${key}` };
    }

    if (meta.phone !== undefined && !Array.isArray(meta.phone)) return { valid: false, error: 'phone must be array' };
    if (meta.email !== undefined && !Array.isArray(meta.email)) return { valid: false, error: 'email must be array' };
    if (meta.address !== undefined && !Array.isArray(meta.address)) return { valid: false, error: 'address must be array' };
    if (meta.organization !== undefined && !Array.isArray(meta.organization)) return { valid: false, error: 'organization must be array' };
    if (meta.notes !== undefined && typeof meta.notes !== 'string') return { valid: false, error: 'notes must be string' };
    if (meta.photo !== undefined && typeof meta.photo !== 'string') return { valid: false, error: 'photo must be base64 string' };
    if (meta.groups !== undefined && !Array.isArray(meta.groups)) return { valid: false, error: 'groups must be array' };
    if (meta.labels !== undefined && !Array.isArray(meta.labels)) return { valid: false, error: 'labels must be array' };

    return { valid: true };
}

/**
 * Merge two metadata objects (used by contact merge).
 * Prefers non-null values from the survivor; deduplicates arrays.
 */
export function mergeContactMeta(a, b) {
    const result = {};
    for (const key of ['phone', 'email', 'address', 'organization', 'groups', 'labels']) {
        const aVal = a[key] || [];
        const bVal = b[key] || [];
        const seen = new Set();
        const merged = [];
        for (const item of [...aVal, ...bVal]) {
            const marker = typeof item === 'object' ? JSON.stringify(item) : String(item);
            if (!seen.has(marker)) {
                seen.add(marker);
                merged.push(item);
            }
        }
        if (merged.length > 0) result[key] = merged;
    }
    if (a.notes || b.notes) result.notes = a.notes || b.notes;
    if (a.photo || b.photo) result.photo = a.photo || b.photo;
    return result;
}

/**
 * Generate a display snippet for a contact's PII (safe for UI rows).
 * Shows first phone/email if available, masked for privacy.
 */
export function contactMetaSnippet(meta) {
    if (!meta) return '';
    const parts = [];
    if (meta.phone?.[0]?.value) {
        const v = meta.phone[0].value;
        const digits = v.replace(/\D/g, '');
        if (digits.length >= 6) {
            const head = digits.slice(0, 2);
            const tail = digits.slice(-2);
            parts.push(`${head}***${tail}`);
        } else {
            parts.push(v);
        }
    }
    if (meta.email?.[0]?.value) {
        const v = meta.email[0].value;
        parts.push(v.replace(/(.{2})(.*)(@.*)/, '$1***$3'));
    }
    if (meta.organization?.[0]?.value) {
        parts.push(meta.organization[0].value);
    }
    return parts.join(' · ');
}
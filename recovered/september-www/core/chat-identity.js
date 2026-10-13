export const ROOT_INFO = 'SovereignPeerRoot-v1';

const randomId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

// An identityId is chosen by the peer and is used as the on-disk contact key
// (`peer_<identityId>`), so it must be an opaque token, never a path. Generated
// ids are `rel_` + a dashes-stripped uuid; the fallback is base36. The signature
// check alone would happily accept `rel_../../pwned` (pentest finding F-02).
const IDENTITY_ID_RE = /^rel_[A-Za-z0-9]{8,64}$/;
const encoder = new TextEncoder();
const bytesToBase64 = bytes => {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
};
const base64ToBytes = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4)), char => char.charCodeAt(0));

export const canonical = value => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
};

export async function generateRelationshipIdentity(displayName = '') {
    const signPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const staticPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const signPublic = await crypto.subtle.exportKey('jwk', signPair.publicKey);
    const staticPublic = new Uint8Array(await crypto.subtle.exportKey('raw', staticPair.publicKey));
    return {
        identityId: `rel_${randomId().replaceAll('-', '')}`,
        displayName,
        signPublicKey: signPublic,
        staticPublicKey: staticPair.publicKey,
        staticPublic: Array.from(staticPublic),
        staticKeyPair: staticPair,
        signPrivateKey: signPair.privateKey,
        staticPrivateKey: staticPair.privateKey
    };
}

export async function fingerprint(payload) {
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode(canonical(payload)));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('').match(/.{1,4}/g).join(' ');
}

export async function createInvite({ identityId, displayName = '', signPublicKey, staticPublic, signPrivateKey, queue, expiresAt }) {
    if (!identityId || !signPublicKey || !staticPublic || !signPrivateKey || !queue || !expiresAt) throw new Error('invite fields are required');
    const unsigned = { version: 1, identityId, displayName, signPublicKey, staticPublicKey: Array.from(staticPublic), queue, expiresAt };
    const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signPrivateKey, encoder.encode(canonical(unsigned)));
    return { ...unsigned, fingerprint: await fingerprint(unsigned), signature: bytesToBase64(new Uint8Array(signature)) };
}

export async function verifyInvite(invite) {
    if (!invite?.signPublicKey || !invite?.staticPublicKey || !invite?.signature || !IDENTITY_ID_RE.test(String(invite?.identityId ?? '')) || invite?.expiresAt <= Date.now()) return false;
    const publicKey = await crypto.subtle.importKey('jwk', invite.signPublicKey, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
    const { signature, fingerprint: claimed, ...unsigned } = invite;
    const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, base64ToBytes(signature), encoder.encode(canonical(unsigned)));
    return valid && claimed === await fingerprint(unsigned);
}

export async function sealPrivateKey(vaultKey, privateKey, algorithm) {
    if (!vaultKey) throw new Error('sealPrivateKey: vault key required');
    const raw = await crypto.subtle.exportKey('pkcs8', privateKey);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, vaultKey, raw);
    return { ciphertext: new Uint8Array(ciphertext), iv, algorithm };
}

export async function unsealPrivateKey(vaultKey, sealed) {
    if (!vaultKey || !sealed || !sealed.ciphertext) throw new Error('unsealPrivateKey: vault key and sealed material required');
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(sealed.iv) }, vaultKey, new Uint8Array(sealed.ciphertext));
    const uses = sealed.algorithm === 'ECDSA' ? ['sign'] : sealed.algorithm === 'ECDH' ? ['deriveBits'] : [];
    return crypto.subtle.importKey('pkcs8', plain, sealed.algorithm === 'ECDSA' ? { name: 'ECDSA', namedCurve: 'P-256' } : { name: 'ECDH', namedCurve: 'P-256' }, false, uses);
}

export async function derivePeerRootSecret(localStaticPrivateKey, peerStaticPublicBytes) {
    const { deriveSharedSecret, hkdf } = await import('./crypto.js');
    const peerPublic = peerStaticPublicBytes instanceof Uint8Array ? peerStaticPublicBytes : new Uint8Array(peerStaticPublicBytes);
    const peerKey = await crypto.subtle.importKey('raw', peerPublic, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
    const shared = new Uint8Array(await deriveSharedSecret(localStaticPrivateKey, peerKey));
    const bytes = new Uint8Array(await hkdf(shared, undefined, ROOT_INFO));
    return bytes.slice(0, 32);
}

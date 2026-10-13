import test from 'node:test';
import assert from 'node:assert/strict';
import { createInvite, derivePeerRootSecret, fingerprint, generateRelationshipIdentity, sealPrivateKey, unsealPrivateKey, verifyInvite } from './chat-identity.js';
import { createQueueCredentials } from './relay-client.js';

test('relationship identity creates stable fingerprint and signed invite', async () => {
    const identity = await generateRelationshipIdentity('Alice');
    const queue = await createQueueCredentials();
    const invite = await createInvite({ identityId: identity.identityId, displayName: identity.displayName, signPublicKey: identity.signPublicKey, staticPublic: identity.staticPublic, signPrivateKey: identity.signPrivateKey, queue: { queueId: queue.queueId, receiveCapability: queue.receiveCapability }, expiresAt: Date.now() + 60000 });
    assert.equal(invite.fingerprint, await fingerprint({ version: 1, identityId: identity.identityId, displayName: identity.displayName, signPublicKey: identity.signPublicKey, staticPublicKey: identity.staticPublic, queue: { queueId: queue.queueId, receiveCapability: queue.receiveCapability }, expiresAt: invite.expiresAt }));
    assert.equal(await verifyInvite(invite), true);
});

test('invite tampering and expiry are rejected', async () => {
    const identity = await generateRelationshipIdentity('Alice');
    const queue = await createQueueCredentials();
    const invite = await createInvite({ identityId: identity.identityId, signPublicKey: identity.signPublicKey, staticPublic: identity.staticPublic, signPrivateKey: identity.signPrivateKey, queue: { queueId: queue.queueId }, expiresAt: Date.now() + 60000 });
    assert.equal(await verifyInvite({ ...invite, displayName: 'Mallory' }), false);
    assert.equal(await verifyInvite({ ...invite, expiresAt: Date.now() - 1 }), false);
});

test('peer root secret matches across peers and differs across pairs', async () => {
    const alice = await generateRelationshipIdentity('Alice');
    const bob = await generateRelationshipIdentity('Bob');
    const eve = await generateRelationshipIdentity('Eve');
    const aRoot = await derivePeerRootSecret(alice.staticPrivateKey, bob.staticPublic);
    const bRoot = await derivePeerRootSecret(bob.staticPrivateKey, alice.staticPublic);
    assert.deepEqual(aRoot, bRoot);
    const aEveRoot = await derivePeerRootSecret(alice.staticPrivateKey, eve.staticPublic);
    assert.notDeepEqual(aRoot, aEveRoot);
});

test('identity private keys seal under vault key and unseal (signing + session)', async () => {
    const identity = await generateRelationshipIdentity('Alice');
    const vaultKey = await crypto.subtle.importKey('raw', crypto.getRandomValues(new Uint8Array(32)), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    const signSealed = await sealPrivateKey(vaultKey, identity.signPrivateKey, 'ECDSA');
    assert.notDeepEqual(Array.from(signSealed.ciphertext), new Uint8Array(await crypto.subtle.exportKey('pkcs8', identity.signPrivateKey)));
    const restoredSign = await unsealPrivateKey(vaultKey, { ciphertext: Array.from(signSealed.ciphertext), iv: Array.from(signSealed.iv), algorithm: 'ECDSA' });
    assert.equal(restoredSign.type, 'private');
    assert.deepEqual(restoredSign.usages, ['sign']);

    const sessionSealed = await sealPrivateKey(vaultKey, identity.staticPrivateKey, 'ECDH');
    const restoredSession = await unsealPrivateKey(vaultKey, { ciphertext: Array.from(sessionSealed.ciphertext), iv: Array.from(sessionSealed.iv), algorithm: 'ECDH' });
    assert.deepEqual(restoredSession.usages, ['deriveBits']);
    const peerRootRestored = await derivePeerRootSecret(restoredSession, identity.staticPublic);
    const peerRootOriginal = await derivePeerRootSecret(identity.staticPrivateKey, identity.staticPublic);
    assert.deepEqual(peerRootRestored, peerRootOriginal);
});
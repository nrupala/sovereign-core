import test from 'node:test';
import assert from 'node:assert/strict';
import { PeerChatSession } from './chat-session.js';
import { derivePeerRootSecret, generateRelationshipIdentity } from './chat-identity.js';

test('peer chat session: initiator to receiver and back with bound root secret', async () => {
    const alice = await generateRelationshipIdentity('Alice');
    const bob = await generateRelationshipIdentity('Bob');
    const root = await derivePeerRootSecret(alice.staticPrivateKey, bob.staticPublic);

    const initiator = new PeerChatSession({ role: 'initiator', rootSecret: root, staticPair: alice.staticKeyPair, peerPublicKey: bob.staticPublic });
    const receiver = new PeerChatSession({ role: 'receiver', rootSecret: root, staticPair: bob.staticKeyPair });

    const first = await initiator.encrypt('hello over verified peers');
    assert.equal(await receiver.decrypt(first.header, first.ciphertext, first.iv), 'hello over verified peers');

    const reply = await receiver.encrypt('ack, pete');
    assert.equal(await initiator.decrypt(reply.header, reply.ciphertext, reply.iv), 'ack, pete');
});

test('peer chat session: wrong root secret is rejected', async () => {
    const alice = await generateRelationshipIdentity('Alice');
    const bob = await generateRelationshipIdentity('Bob');
    const eveRoot = await derivePeerRootSecret((await generateRelationshipIdentity('Eve')).staticPrivateKey, bob.staticPublic);

    const initiator = new PeerChatSession({ role: 'initiator', rootSecret: eveRoot, staticPair: alice.staticKeyPair, peerPublicKey: bob.staticPublic });
    const receiver = new PeerChatSession({ role: 'receiver', rootSecret: await derivePeerRootSecret(bob.staticPrivateKey, alice.staticPublic), staticPair: bob.staticKeyPair });
    const first = await initiator.encrypt('secret');
    await assert.rejects(() => receiver.decrypt(first.header, first.ciphertext, first.iv));
});

test('peer chat session: snapshot round-trip resumes a live conversation', async () => {
    const alice = await generateRelationshipIdentity('Alice');
    const bob = await generateRelationshipIdentity('Bob');
    const root = await derivePeerRootSecret(alice.staticPrivateKey, bob.staticPublic);

    const initiator = new PeerChatSession({ role: 'initiator', rootSecret: root, staticPair: alice.staticKeyPair, peerPublicKey: bob.staticPublic });
    const receiver = new PeerChatSession({ role: 'receiver', rootSecret: root, staticPair: bob.staticKeyPair });

    const m1 = await initiator.encrypt('message one');
    assert.equal(await receiver.decrypt(m1.header, m1.ciphertext, m1.iv), 'message one');

    // Mid-conversation: snapshot both sides, survive a JSON trip (as sealed-at-rest storage does),
    // and verify the continued conversation decrypts after restore.
    const initiatorRestored = await PeerChatSession.restore(JSON.parse(JSON.stringify(await initiator.serialize())));
    const receiverRestored = await PeerChatSession.restore(JSON.parse(JSON.stringify(await receiver.serialize())));

    const m2 = await initiatorRestored.encrypt('message two');
    assert.equal(await receiverRestored.decrypt(m2.header, m2.ciphertext, m2.iv), 'message two');

    const reply = await receiverRestored.encrypt('ack after restart');
    assert.equal(await initiatorRestored.decrypt(reply.header, reply.ciphertext, reply.iv), 'ack after restart');
});

test('peer chat session: skipped message keys survive a snapshot/restore', async () => {
    const alice = await generateRelationshipIdentity('Alice');
    const bob = await generateRelationshipIdentity('Bob');
    const root = await derivePeerRootSecret(alice.staticPrivateKey, bob.staticPublic);

    const initiator = new PeerChatSession({ role: 'initiator', rootSecret: root, staticPair: alice.staticKeyPair, peerPublicKey: bob.staticPublic });
    const receiver = new PeerChatSession({ role: 'receiver', rootSecret: root, staticPair: bob.staticKeyPair });

    const outOfOrder = await initiator.encrypt('first, arriving late');
    const later = await initiator.encrypt('second, arriving sooner');
    assert.equal(await receiver.decrypt(later.header, later.ciphertext, later.iv), 'second, arriving sooner');

    const receiverRestored = await PeerChatSession.restore(JSON.parse(JSON.stringify(await receiver.serialize())));
    assert.equal(await receiverRestored.decrypt(outOfOrder.header, outOfOrder.ciphertext, outOfOrder.iv), 'first, arriving late');
});
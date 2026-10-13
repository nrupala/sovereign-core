import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnvelope, createQueueCredentials, deliveryState, mergeRelayMessages } from './relay-client.js';

test('relay credentials are relationship-scoped and seven-day bounded', async () => {
    const credentials = await createQueueCredentials();
    assert.match(credentials.queueId, /^q_[A-Za-z0-9_-]{16,128}$/);
    assert.notEqual(credentials.sendSecret, credentials.receiveSecret);
    assert.equal(credentials.expiresAt - credentials.createdAt, 7 * 24 * 60 * 60 * 1000);
    assert.notEqual(credentials.sendCapability, credentials.sendSecret);
});

test('relay envelope requires opaque ciphertext, iv, and header', () => {
    const envelope = createEnvelope({ ciphertext: 'opaque', iv: 'iv', header: { n: 0 }, messageId: 'm1' });
    assert.equal(envelope.type, 'message');
    assert.throws(() => createEnvelope({ ciphertext: '', iv: 'iv', header: {} }));
    assert.throws(() => createEnvelope({ ciphertext: 'opaque', header: {} }));
});

test('dual relay merge deduplicates by messageId', () => {
    const result = mergeRelayMessages([{ messageId: 'b', createdAt: 2 }, { messageId: 'a', createdAt: 1 }], [{ messageId: 'b', createdAt: 2 }]);
    assert.deepEqual(result.map(item => item.messageId), ['a', 'b']);
});

test('delivery state reflects available relay copy', () => {
    assert.equal(deliveryState({ primary: 'failed', secondary: 'delivered' }), 'delivered');
    assert.equal(deliveryState({ primary: 'queued', secondary: 'failed' }), 'queued');
    assert.equal(deliveryState({ primary: 'failed', secondary: 'failed' }), 'failed');
});

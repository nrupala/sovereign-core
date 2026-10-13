import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEnvelope, sendRelayMessage } from './relay-client.js';

/**
 * Receive-path liveness and re-handshake recovery (core/peer.js pollPeerInbox).
 *
 * Covers two defects that previously wedged a conversation permanently:
 *  - A peer that resets its ratchet (reinstall / lost state / clearPeerSessions)
 *    sends a fresh handshake init that could never decrypt under the stale
 *    session, and was never acked, so the relay re-served it forever.
 *  - An envelope that fails to decrypt under both the current and a fresh
 *    session could never become decryptable later, yet was never acked.
 *
 * The recovery MUST NOT let a forged envelope destroy a live session: the reset
 * is committed only when the retry authenticates (AEAD), so junk is acked once
 * and dropped while legitimate same-session mail keeps flowing.
 */

const root = fileURLToPath(new URL('..', import.meta.url));
const BASE = 'http://127.0.0.2:8903';

let relay;
let tmp;
let alice;
let bob;
let aliceToBob;
let bobToAlice;
let aliceId;
let bobQueue;
let nextId = 0;

function b64url(bytes) {
    return Buffer.from(bytes).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function junkEnvelope(messageId) {
    const rand = length => b64url(crypto.getRandomValues(new Uint8Array(length)));
    return createEnvelope({
        messageId,
        ciphertext: rand(64),
        header: { from: aliceId, dh: rand(32), n: 0, pn: 0 },
        iv: rand(12)
    });
}

function agent(role) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['core/peer-agent.mjs'], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
        const pending = new Map();
        let buffer = '';
        child.stdout.on('data', chunk => {
            buffer += chunk;
            let index;
            while ((index = buffer.indexOf('\n')) !== -1) {
                const line = buffer.slice(0, index).trim();
                buffer = buffer.slice(index + 1);
                if (!line) continue;
                let message;
                try { message = JSON.parse(line); } catch { continue; }
                const entry = pending.get(message.id);
                if (entry) { pending.delete(message.id); entry(message); }
            }
        });
        child.stderr.on('data', chunk => console.error(`[${role}]`, chunk.toString()));
        child.on('error', reject);
        child.on('exit', code => { if (code !== 0) reject(new Error(`${role} exited ${code}`)); });
        resolve({
            ask(op, args = {}) {
                const id = ++nextId;
                return new Promise(resolve2 => {
                    pending.set(id, resolve2);
                    child.stdin.write(JSON.stringify({ id, op, ...args }) + '\n');
                });
            },
            kill() { child.stdin.end(); child.kill(); }
        });
    });
}

test.before(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'sovereign-peer-reset-'));
    relay = spawn(process.execPath, ['relay/node/server.mjs'], {
        cwd: root,
        env: { ...process.env, PORT: '8903', RELAY_HOST: '127.0.0.2', RELAY_DB: join(tmp, 'relay.sqlite') },
        stdio: ['ignore', 'ignore', 'ignore']
    });
    for (let i = 0; i < 40; i++) {
        try { await fetch(`${BASE}/healthz`); break; } catch { await new Promise(r => setTimeout(r, 100)); }
    }
    alice = await agent('alice');
    bob = await agent('bob');

    const aProfile = await alice.ask('create', { password: 'alice-password', displayName: 'Alice', baseUrl: BASE });
    assert.equal(aProfile.ok, true);
    const bProfile = await bob.ask('create', { password: 'bob-password', displayName: 'Bob', baseUrl: BASE });
    assert.equal(bProfile.ok, true);

    const aInvite = await alice.ask('invite');
    const bInvite = await bob.ask('invite');
    assert.equal(aInvite.ok, true);
    assert.equal(bInvite.ok, true);
    aliceId = aInvite.result.identityId;
    bobQueue = bInvite.result.queue;

    aliceToBob = (await alice.ask('accept', { invite: bInvite.result, alias: 'Bob' })).result;
    bobToAlice = (await bob.ask('accept', { invite: aInvite.result, alias: 'Alice' })).result;
    assert.match(aliceToBob, /^peer_/);
    assert.match(bobToAlice, /^peer_/);
});

test.after(async () => {
    alice?.kill();
    bob?.kill();
    relay?.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 150));
    if (tmp) await rm(tmp, { recursive: true, force: true });
});

test('forged junk from a known contact is acked once without destroying the session or wedging the queue', async () => {
    const sent1 = await alice.ask('send', { contactId: aliceToBob, text: 'baseline-1' });
    assert.equal(sent1.ok, true);
    const poll1 = await bob.ask('poll');
    assert.ok(poll1.result.some(m => m.text === 'baseline-1'), 'baseline session must establish');

    // Anyone holding the invite's send capability can post a forged envelope
    // claiming to be the known contact; its ciphertext cannot authenticate.
    await sendRelayMessage(bobQueue.baseUrl, bobQueue.queueId, bobQueue.outCapability, junkEnvelope('m_forged_junk_1'));

    // Alice continues the SAME session (no reset): this must still decrypt.
    const sent2 = await alice.ask('send', { contactId: aliceToBob, text: 'after-junk-same-session' });
    assert.equal(sent2.ok, true);

    const pollJunk = await bob.ask('poll');
    assert.equal(pollJunk.ok, true);
    const flagged = pollJunk.result.find(m => m.messageId === 'm_forged_junk_1');
    assert.ok(flagged, 'forged envelope must be surfaced, not silently swallowed');
    assert.equal(flagged.undecryptable, true);
    assert.equal(flagged.incoming, false);
    assert.ok(
        pollJunk.result.some(m => m.text === 'after-junk-same-session'),
        'same-session mail must still decrypt: the forged envelope must not destroy the live session'
    );
    assert.ok(!pollJunk.result.some(m => m.text === 'baseline-1'), 'acked mail must not be re-served');

    // Liveness: the forged envelope was acked, so the next poll never sees it again.
    const pollAgain = await bob.ask('poll');
    assert.ok(
        !pollAgain.result.some(m => m.messageId === 'm_forged_junk_1'),
        'undecryptable envelope must be acked exactly once, never re-served'
    );
});

test('a peer that resets its ratchet is accepted (fresh handshake init re-keys the receiver)', async () => {
    await alice.ask('clearsessions');

    const sent = await alice.ask('send', { contactId: aliceToBob, text: 'post-reset-fresh-init' });
    assert.equal(sent.ok, true);

    const pollReset = await bob.ask('poll');
    assert.equal(pollReset.ok, true);
    assert.ok(
        pollReset.result.some(m => m.text === 'post-reset-fresh-init'),
        'fresh handshake init must be accepted and re-key the receiver session'
    );

    // The re-keyed session must be usable bidirectionally.
    const reply = await bob.ask('send', { contactId: bobToAlice, text: 'reply-after-reset' });
    assert.equal(reply.ok, true);
    const alicePoll = await alice.ask('poll');
    assert.ok(
        alicePoll.result.some(m => m.text === 'reply-after-reset'),
        'reply on the re-keyed session must reach the resetting peer'
    );
});

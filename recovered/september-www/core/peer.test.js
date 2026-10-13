import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const BASE = 'http://127.0.0.2:8902';

let relay;
let tmp;
let alice;
let bob;
let nextId = 0;

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
    tmp = await mkdtemp(join(tmpdir(), 'sovereign-peer-e2e-'));
    relay = spawn(process.execPath, ['relay/node/server.mjs'], {
        cwd: root,
        env: { ...process.env, PORT: '8902', RELAY_HOST: '127.0.0.2', RELAY_DB: join(tmp, 'relay.sqlite') },
        stdio: ['ignore', 'ignore', 'ignore']
    });
    for (let i = 0; i < 40; i++) {
        try { await fetch(`${BASE}/healthz`); break; } catch { await new Promise(r => setTimeout(r, 100)); }
    }
    alice = await agent('alice');
    bob = await agent('bob');
});

test.after(async () => {
    alice?.kill();
    bob?.kill();
    relay?.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 150));
    if (tmp) await rm(tmp, { recursive: true, force: true });
});

test('Alice and Bob exchange an E2EE text through the relay', async () => {
    const aProfile = await alice.ask('create', { password: 'alice-password', displayName: 'Alice', baseUrl: BASE });
    assert.equal(aProfile.ok, true);
    assert.match(aProfile.result.identityId, /^rel_/);

    const bProfile = await bob.ask('create', { password: 'bob-password', displayName: 'Bob', baseUrl: BASE });
    assert.equal(bProfile.ok, true);

    const aInvite = await alice.ask('invite');
    assert.equal(aInvite.ok, true);
    assert.ok(aInvite.result.signature);

    const bInvite = await bob.ask('invite');
    assert.equal(bInvite.ok, true);

    const aAcceptsBob = await alice.ask('accept', { invite: bInvite.result, alias: 'Bob' });
    assert.equal(aAcceptsBob.ok, true);
    assert.match(aAcceptsBob.result, /^peer_/);

    const bAcceptsAlice = await bob.ask('accept', { invite: aInvite.result, alias: 'Alice' });
    assert.equal(bAcceptsAlice.ok, true);

    const sent = await alice.ask('send', { contactId: aAcceptsBob.result, text: 'hello over verified relay' });
    assert.equal(sent.ok, true);
    assert.match(sent.result, /^m_/);

    const received = await bob.ask('poll');
    assert.equal(received.ok, true);
    assert.ok(received.result.length >= 1);
    assert.equal(received.result[0].text, 'hello over verified relay');
    assert.equal(received.result[0].incoming, true);
});

test('Bob replies and Alice receives the reply in the same session', async () => {
    const bReply = await bob.ask('send', { contactId: (await bob.ask('contacts')).result[0].id, text: 'ack back at you' });
    assert.equal(bReply.ok, true);

    const received = await alice.ask('poll');
    assert.equal(received.ok, true);
    assert.ok(received.result.length >= 1);
    assert.equal(received.result[0].text, 'ack back at you');
});

test('unknown-sender mail is dropped without blocking known-sender mail', async () => {
    // Carol can push into Alice's queue via Alice's invite, but Alice never accepts
    // her: the poll must ack-and-drop her mail (inbox stays clean) and keep routing
    // known-sender traffic through the deterministic direct contact lookup.
    const carol = await agent('carol');
    try {
        const cProfile = await carol.ask('create', { password: 'carol-password', displayName: 'Carol', baseUrl: BASE });
        assert.equal(cProfile.ok, true);

        const aInvite = await alice.ask('invite');
        assert.equal(aInvite.ok, true);
        const carolAcceptsAlice = await carol.ask('accept', { invite: aInvite.result, alias: 'Alice' });
        assert.equal(carolAcceptsAlice.ok, true);

        const carolSends = await carol.ask('send', { contactId: carolAcceptsAlice.result, text: 'you do not know me' });
        assert.equal(carolSends.ok, true);

        const poll1 = await alice.ask('poll');
        assert.equal(poll1.ok, true);
        assert.equal(poll1.result.find(m => m.text === 'you do not know me'), undefined);

        // A subsequent known exchange is unaffected (routing not poisoned by the drop).
        const sent = await alice.ask('send', { contactId: (await alice.ask('contacts')).result[0].id, text: 'still standing' });
        assert.equal(sent.ok, true);
        const bobPoll = await bob.ask('poll');
        assert.equal(bobPoll.ok, true);
        assert.ok(bobPoll.result.some(m => m.text === 'still standing'));
    } finally {
        carol.kill();
    }
});

test('direct contact lookup matches the deterministic peer_<identityId> id', async () => {
    const { initNodeFileStore, saveContact, getContact, getAllContacts } = await import('./chat-db.js');
    const dir = join(tmp, 'contact-lookup');
    await initNodeFileStore(dir);
    const identityId = 'rel_testdirectlookup';
    const contactId = `peer_${identityId}`;
    await saveContact({ id: contactId, name: 'Direct', publicKey: [1, 2, 3], createdAt: Date.now(), peer: { identityId, fingerprint: 'fp', queue: { baseUrl: 'x', queueId: 'q', outCapability: 'c' }, staticPublic: [1, 2, 3] } });
    const direct = await getContact(contactId);
    assert.ok(direct?.peer);
    assert.equal(direct.peer.identityId, identityId);
    const scanned = (await getAllContacts()).find(c => c.peer?.identityId === identityId);
    assert.deepEqual(direct, scanned);
});

test('nodefs keyring records with colon ids persist, list, and delete (Windows ADS regression)', async () => {
    const { initNodeFileStore, saveKeyringEntry, getKeyringEntry, getAllKeyringEntries, deleteKeyringEntry } = await import('./chat-db.js');
    const dir = join(tmp, 'keyring-nodefs');
    await initNodeFileStore(dir);
    const id = 'peer_session:peer_rel_adsregression';
    await saveKeyringEntry({ id, meta: { ok: true } });
    assert.equal((await getKeyringEntry(id))?.meta?.ok, true);
    // The listing MUST see colon-id records; before the winSafeFile fix, readdir
    // returned only the ADS base name and clearPeerSessions silently deleted nothing.
    assert.ok((await getAllKeyringEntries()).some(e => e?.id === id));
    await deleteKeyringEntry(id);
    assert.equal(await getKeyringEntry(id), null);
    assert.ok(!(await getAllKeyringEntries()).some(e => e?.id === id));
});

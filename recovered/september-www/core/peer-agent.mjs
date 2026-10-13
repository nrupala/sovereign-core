import readline from 'node:readline';
import { deriveKey } from './crypto.js';
import * as peer from './peer.js';
import { initNodeFileStore } from './chat-db.js';

const storageDir = process.argv.includes('--storage') ? process.argv[process.argv.indexOf('--storage') + 1] : null;
if (storageDir) await initNodeFileStore(storageDir);

let vaultKey = null;

const handlers = {
    // Idempotent: a persistent profile (from a prior run with the same
    // password and storage dir) is re-used instead of being regenerated.
    async create({ password, displayName, baseUrl }) {
        vaultKey = await deriveKey(password, new Uint8Array(16));
        let profile = await peer.getPeerProfileSummary();
        if (!profile) {
            profile = await peer.createPeerProfile(vaultKey, displayName);
        }
        // No-op when an inbox already exists (keeps the stored relay binding).
        await peer.createInboxQueue(vaultKey, baseUrl);
        return profile;
    },
    async invite() {
        return peer.exportPeerInvite(vaultKey);
    },
    async accept({ invite, alias }) {
        return peer.acceptPeerContact(invite, alias);
    },
    async contacts() {
        return peer.getPeerContacts();
    },
    async send({ contactId, text }) {
        return peer.sendPeerText(vaultKey, contactId, text);
    },
    async poll() {
        return peer.pollPeerInbox(vaultKey);
    },
    async clearsessions() {
        await peer.clearPeerSessions();
        return { cleared: true };
    }
};

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async line => {
    if (!line.trim()) return;
    let request;
    try {
        request = JSON.parse(line);
    } catch {
        process.stdout.write(JSON.stringify({ id: null, ok: false, error: 'invalid json' }) + '\n');
        return;
    }
    try {
        const result = await handlers[request.op](request);
        process.stdout.write(JSON.stringify({ id: request.id, ok: true, result }) + '\n');
    } catch (error) {
        process.stdout.write(JSON.stringify({ id: request.id, ok: false, error: String(error?.message || error) }) + '\n');
    }
});

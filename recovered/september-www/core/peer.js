import { createEnvelope, createQueueCredentials, provisionRelayQueue, sendRelayMessage, pullRelayMessages, ackRelayMessage } from './relay-client.js';
import { createInvite, derivePeerRootSecret, generateRelationshipIdentity, sealPrivateKey, unsealPrivateKey, verifyInvite } from './chat-identity.js';
import { PeerChatSession } from './chat-session.js';
import { deleteKeyringEntry, getAllContacts, getAllKeyringEntries, getContact, getKeyringEntry, saveContact, saveKeyringEntry } from './chat-db.js';

const ID_META = 'peer_profile:meta';
const ID_SIGN = 'peer_profile:sign';
const ID_STATIC = 'peer_profile:static';
const ID_INBOX = 'peer_profile:inbox';
const SESSION_KEY_PREFIX = 'peer_session:';

const liveSessions = new Map();

function uid() {
    const r = crypto.randomUUID ? crypto.randomUUID().replaceAll('-', '') : Math.random().toString(36).slice(2) + Date.now().toString(36);
    return `m_${r}`;
}

// Inbound envelopes are authored by the remote peer, so their ids are untrusted.
// `envelope.messageId` is used as the stored message record id and in the relay
// ack URL; `envelope.header.from` builds the `peer_<identityId>` contact key.
// Validate both, and map a rejected message id to a deterministic safe local id
// (same input -> same id, so a pre-ack re-poll stays idempotent) instead of
// dropping real mail (pentest finding F-02).
const PEER_ID_RE = /^rel_[A-Za-z0-9]{8,64}$/;
const SAFE_MESSAGE_ID_RE = /^[A-Za-z0-9_:.=-]{1,128}$/;

function safeMessageId(raw) {
    const s = String(raw ?? '');
    if (SAFE_MESSAGE_ID_RE.test(s) && !s.includes('..')) return s;
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    const tail = s.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24);
    return `m_${h.toString(16).padStart(8, '0')}${tail ? '_' + tail : ''}`;
}

function encode(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function decode(value) {
    const pad = '='.repeat((4 - value.length % 4) % 4);
    return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/') + pad), char => char.charCodeAt(0));
}

async function sealString(key, plaintext) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
    return { ciphertext: new Uint8Array(ciphertext), iv };
}

async function unsealString(key, sealed) {
    const iv = sealed.iv instanceof Uint8Array ? sealed.iv : new Uint8Array(sealed.iv);
    const ciphertext = sealed.ciphertext instanceof Uint8Array ? sealed.ciphertext : new Uint8Array(sealed.ciphertext);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return new TextDecoder().decode(plain);
}

/* ---------- Profile ---------- */

export async function hasPeerProfile() {
    return !!(await getKeyringEntry(ID_META));
}

export async function getPeerProfileSummary() {
    const meta = await getKeyringEntry(ID_META);
    if (!meta?.meta) return null;
    return {
        identityId: meta.meta.identityId,
        displayName: meta.meta.displayName,
        signPublicKey: meta.meta.signPublicKey,
        staticPublicKey: meta.meta.staticPublicKey
    };
}

export async function createPeerProfile(vaultKey, displayName = '') {
    if (await hasPeerProfile()) throw new Error('peer profile already exists');
    const identity = await generateRelationshipIdentity(displayName);
    await saveKeyringEntry({ id: ID_SIGN, sealed: await sealPrivateKey(vaultKey, identity.signPrivateKey, 'ECDSA') });
    await saveKeyringEntry({ id: ID_STATIC, sealed: await sealPrivateKey(vaultKey, identity.staticPrivateKey, 'ECDH') });
    await saveKeyringEntry({
        id: ID_META,
        meta: { kind: 'profile', identityId: identity.identityId, displayName, signPublicKey: identity.signPublicKey, staticPublicKey: identity.staticPublic }
    });
    return getPeerProfileSummary();
}

/* ---------- Inbox ---------- */

export async function createInboxQueue(vaultKey, relayBaseUrl) {
    if (!relayBaseUrl) throw new Error('relayBaseUrl is required');
    if (await getKeyringEntry(ID_INBOX)) return null;
    const credentials = await createQueueCredentials();
    await provisionRelayQueue(relayBaseUrl, credentials);
    await saveKeyringEntry({
        id: ID_INBOX,
        sealed: await sealString(vaultKey, JSON.stringify({
            baseUrl: relayBaseUrl,
            queueId: credentials.queueId,
            receiveSecret: credentials.receiveSecret,
            sendSecret: credentials.sendSecret
        }))
    });
    return { queueId: credentials.queueId, sendSecret: credentials.sendSecret };
}

async function readInbox(vaultKey) {
    const record = await getKeyringEntry(ID_INBOX);
    if (!record?.sealed) return null;
    return JSON.parse(await unsealString(vaultKey, record.sealed));
}

/* ---------- Invite exchange ---------- */

export async function exportPeerInvite(vaultKey) {
    const [meta, signSealed, staticSealed, inbox] = await Promise.all([
        getKeyringEntry(ID_META),
        getKeyringEntry(ID_SIGN),
        getKeyringEntry(ID_STATIC),
        getKeyringEntry(ID_INBOX)
    ]);
    if (!meta?.meta || !signSealed?.sealed || !staticSealed?.sealed || !inbox?.sealed) throw new Error('peer profile, keys, or inbox missing');
    const inboxData = JSON.parse(await unsealString(vaultKey, inbox.sealed));
    const signPrivate = await unsealPrivateKey(vaultKey, signSealed.sealed);
    return createInvite({
        identityId: meta.meta.identityId,
        displayName: meta.meta.displayName,
        signPublicKey: meta.meta.signPublicKey,
        staticPublic: meta.meta.staticPublicKey,
        signPrivateKey: signPrivate,
        queue: { baseUrl: inboxData.baseUrl, queueId: inboxData.queueId, outCapability: inboxData.sendSecret },
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000
    });
}

export async function acceptPeerContact(invite, alias, vaultKey) {
    if (!invite?.identityId || !await verifyInvite(invite)) throw new Error('invite invalid or expired');
    const contactId = `peer_${invite.identityId}`;
    await saveContact({
        id: contactId,
        name: alias || invite.displayName || 'Peer',
        publicKey: invite.staticPublicKey,
        createdAt: Date.now(),
        peer: { identityId: invite.identityId, fingerprint: invite.fingerprint, queue: invite.queue, staticPublic: invite.staticPublicKey },
        vaultKey
    });
    return contactId;
}

export async function getPeerContacts(vaultKey) {
    const all = await getAllContacts(vaultKey);
    return all.filter(c => c.peer).map(c => ({ id: c.id, name: c.name, fingerprint: c.peer.fingerprint, identityId: c.peer.identityId }));
}

/* ---------- Sessions ---------- */

async function myStaticPair(vaultKey) {
    const meta = await getKeyringEntry(ID_META);
    const staticSealed = await getKeyringEntry(ID_STATIC);
    if (!meta?.meta || !staticSealed?.sealed) throw new Error('peer profile and static key required');
    const privateKey = await unsealPrivateKey(vaultKey, staticSealed.sealed);
    const publicKey = await crypto.subtle.importKey('raw', new Uint8Array(meta.meta.staticPublicKey), { name: 'ECDH', namedCurve: 'P-256' }, true, []);
    return { privateKey, publicKey };
}

async function contactFor(contactId, vaultKey) {
    const all = await getAllContacts(vaultKey);
    const contact = all.find(c => c.id === contactId);
    if (!contact?.peer) throw new Error('peer contact not found');
    return contact;
}

async function sessionFor(vaultKey, contactId, roleHint) {
    if (liveSessions.has(contactId)) return liveSessions.get(contactId);
    const persisted = await getKeyringEntry(`${SESSION_KEY_PREFIX}${contactId}`);
    if (persisted?.sealed) {
        try {
            const snapshot = JSON.parse(await unsealString(vaultKey, persisted.sealed));
            const session = await PeerChatSession.restore(snapshot);
            liveSessions.set(contactId, session);
            return session;
        } catch (err) {
            console.warn('[peer] session restore failed for', contactId, err?.message || err);
            await deleteKeyringEntry(`${SESSION_KEY_PREFIX}${contactId}`).catch(() => {});
        }
    }
    const contact = await contactFor(contactId, vaultKey);
    const session = await buildSession(vaultKey, contact, roleHint);
    liveSessions.set(contactId, session);
    await persistSession(vaultKey, contactId, session);
    return session;
}

/**
 * Construct a session from static keys WITHOUT touching live or persisted state.
 * Used for the receive-path recovery attempt: a candidate is built, and only a
 * candidate that actually authenticates an envelope is ever committed.
 */
async function buildSession(vaultKey, contact, role) {
    const me = await myStaticPair(vaultKey);
    const peerRaw = new Uint8Array(contact.peer.staticPublic);
    const root = await derivePeerRootSecret(me.privateKey, peerRaw);
    return new PeerChatSession({
        role,
        rootSecret: root,
        staticPair: me,
        peerPublicKey: role === 'initiator' ? peerRaw : null
    });
}

export async function clearPeerSessions() {
    liveSessions.clear();
    const entries = await getAllKeyringEntries();
    for (const entry of entries) {
        if (entry?.id?.startsWith(SESSION_KEY_PREFIX)) {
            await deleteKeyringEntry(entry.id).catch(() => {});
        }
    }
}

async function persistSession(vaultKey, contactId, session) {
    try {
        const snapshot = await session.serialize();
        if (!snapshot) return;
        await saveKeyringEntry({ id: `${SESSION_KEY_PREFIX}${contactId}`, sealed: await sealString(vaultKey, JSON.stringify(snapshot)) });
    } catch (err) {
        console.warn('[peer] session persist failed for', contactId, err?.message || err);
    }
}

/* ---------- Send and receive ---------- */

export async function sendPeerText(vaultKey, contactId, text) {
    const contact = await contactFor(contactId);
    const queue = contact.peer.queue;
    if (!queue?.baseUrl || !queue.queueId || !queue.outCapability) throw new Error('contact outbox not configured');
    const me = await getPeerProfileSummary();
    const session = await sessionFor(vaultKey, contactId, 'initiator');
    const sealed = await session.encrypt(text);
    await persistSession(vaultKey, contactId, session);
    const envelope = createEnvelope({
        ciphertext: encode(sealed.ciphertext),
        header: { from: me.identityId, dh: encode(sealed.header.dh), n: sealed.header.n, pn: sealed.header.pn },
        iv: encode(sealed.iv),
        messageId: uid()
    });
    await sendRelayMessage(queue.baseUrl, queue.queueId, queue.outCapability, envelope);
    return envelope.messageId;
}

export async function pollPeerInbox(vaultKey) {
    const inbox = await readInbox(vaultKey);
    if (!inbox) return [];
    const page = await pullRelayMessages(inbox.baseUrl, inbox.queueId, inbox.receiveSecret);
    const contacts = await getAllContacts(vaultKey);
    const output = [];
    for (const envelope of page.messages) {
        const fromId = envelope.header?.from;
        // Deterministic id: acceptPeerContact always saves contacts as peer_<identityId>.
        // Prefer the single-file direct read; only fall back to the scan. A sender the
        // direct lookup CONFIRMS as absent is the only case eligible for ack-and-drop —
        // a read error must never turn real mail into a permanent loss. A fromId that is
        // not a well-formed identity id cannot match any contact, so skip the lookup.
        let contact = null;
        let lookupFailed = false;
        if (typeof fromId === 'string' && PEER_ID_RE.test(fromId)) {
            try {
                const direct = await getContact(`peer_${fromId}`, vaultKey);
                if (direct?.peer) contact = direct;
            } catch (err) { lookupFailed = true; }
        }
        if (!contact && !lookupFailed) {
            contact = contacts.find(c => c.peer?.identityId === fromId) || null;
        }
        let text = null;
        let undecryptable = false;
        let accepted = !contact && !lookupFailed; // unknown sender cannot be decrypted: ack-and-drop to keep the inbox clean
        if (contact) {
            const previous = liveSessions.get(contact.id) || null;
            const header = { dh: decode(envelope.header.dh), n: envelope.header.n, pn: envelope.header.pn };
            const ciphertext = decode(envelope.ciphertext);
            const iv = decode(envelope.iv);
            try {
                const session = await sessionFor(vaultKey, contact.id, 'receiver');
                text = await session.decrypt(header, ciphertext, iv);
                await persistSession(vaultKey, contact.id, session);
                accepted = true;
            } catch {
                // A peer that reset its ratchet (reinstall / lost state / clearPeerSessions)
                // starts a fresh handshake that cannot decrypt under the stale session.
                // Attempt a fresh receiver session, but commit it ONLY if the envelope
                // authenticates under it — a forged or replayed envelope can never
                // authenticate, so a good session is never destroyed by junk.
                try {
                    const candidate = await buildSession(vaultKey, contact, 'receiver');
                    const candidateText = await candidate.decrypt(header, ciphertext, iv);
                    liveSessions.set(contact.id, candidate);
                    await persistSession(vaultKey, contact.id, candidate);
                    text = candidateText;
                    accepted = true;
                } catch {
                    // Undecryptable under both the current and a fresh session: its
                    // establishing init was lost, or it was tampered with. It can never
                    // become decryptable later, so ack it to keep the queue advancing.
                    if (previous) liveSessions.set(contact.id, previous);
                    undecryptable = true;
                    console.warn('[peer] undecryptable message from', fromId, 'acknowledged and dropped');
                }
            }
        }
        // Store under a validated local id; ack the relay with the original id
        // (relay-client URL-encodes it, so it cannot alter the request path).
        if (accepted) output.push({ messageId: safeMessageId(envelope.messageId), from: fromId, text, incoming: text !== null });
        else if (undecryptable) output.push({ messageId: safeMessageId(envelope.messageId), from: fromId, text: null, incoming: false, undecryptable: true });
        if (accepted || undecryptable) await ackRelayMessage(inbox.baseUrl, inbox.queueId, inbox.receiveSecret, envelope.messageId);
    }
    return output;
}

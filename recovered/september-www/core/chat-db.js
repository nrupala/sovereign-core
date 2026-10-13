/**
 * Sovereign Core v2.0 - Isolated Chat Database
 * Contacts, conversations, and message storage, fully separate from the vessel
 * vault storage (core/db.js). Follows the same Fort Knox storage doctrine:
 * OPFS primary, IndexedDB fallback, in-memory last resort (also enables Node
 * 20+ testing). Zero external dependencies.
 *
 * Message bodies are stored ONLY as ciphertext (AES-256-GCM) with per-message
 * IVs. The database never holds plaintext chat content. Key pairs are ECDH
 * P-256 (WebCrypto), suitable for Double Ratchet session bootstrap.
 */

import { generateECDHKeyPair, exportPublicKey as cryptoExportPublicKey, encryptData as cryptoEncrypt, decryptData as cryptoDecrypt } from './crypto.js';
import { sealContactMeta, openContactMeta, validateContactMeta, mergeContactMeta } from './contact-meta.js';

const IDB_NAME = 'sovereign-chat-v1';
const IDB_VERSION = 1;
const STORES = ['contacts', 'conversations', 'messages', 'attachments', 'keyring', 'contact_merge_log'];

let mode = 'none'; // 'opfs' | 'indexeddb' | 'nodefs' | 'memory'
let initPromise = null;
let opfsRoot = null;
let idb = null;
let nodefsRoot = null;
const memory = { contacts: new Map(), conversations: new Map(), messages: new Map(), attachments: new Map(), keyring: new Map(), contact_merge_log: new Map() };

function log(level, msg, err) {
    if (level === 'error') console.error('[ChatDB]', msg, err || '');
    else if (level === 'warn') console.warn('[ChatDB]', msg, err || '');
    else console.log('[ChatDB]', msg);
}

async function initOPFS() {
    try {
        if (!navigator.storage || !navigator.storage.getDirectory) return false;
        opfsRoot = await navigator.storage.getDirectory();
        // OPFS forbids slashes in names: resolve nested handles one level at a time.
        const chatDir = await opfsRoot.getDirectoryHandle('chat', { create: true });
        for (const dir of ['contacts', 'conversations', 'messages', 'attachments', 'keyring', 'contact_merge_log']) {
            await chatDir.getDirectoryHandle(dir, { create: true });
        }
        mode = 'opfs';
        log('info', 'OPFS initialized (PRIMARY chat storage)');
        return true;
    } catch (err) { log('warn', 'OPFS init failed', err); return false; }
}

function openIDB() {
    return new Promise((resolve) => {
        try {
            const req = indexedDB.open(IDB_NAME, IDB_VERSION);
            req.onupgradeneeded = () => {
                const d = req.result;
                for (const s of STORES) {
                    if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' });
                }
            };
            req.onsuccess = () => { idb = req.result; resolve(true); };
            req.onerror = () => resolve(false);
        } catch { resolve(false); }
    });
}

/** Node-side persistent chat store (desktop agents / CI). JSON files, one per record. */
export async function initNodeFileStore(dir) {
    if (!dir) throw new Error('initNodeFileStore: directory is required');
    const fs = await import('node:fs/promises');
    await fs.mkdir(dir, { recursive: true });
    for (const s of STORES) await fs.mkdir(`${dir}/${s}`, { recursive: true });
    nodefsRoot = dir;
    mode = 'nodefs';
    log('info', `Node file store initialized (${dir})`);
    return dir;
}

async function ensureInit() {
    if (mode !== 'none') return;
    if (initPromise) return initPromise;
    initPromise = (async () => {
        if (typeof navigator !== 'undefined' && navigator.storage) {
            if (await initOPFS()) return;
            if (typeof indexedDB !== 'undefined' && await openIDB()) { mode = 'indexeddb'; return; }
        }
        mode = 'memory';
        log('warn', 'Falling back to in-memory chat storage (non-persistent)');
    })();
    return initPromise;
}

/* ---------- OPFS primitives ---------- */

async function opfsWrite(path, obj) {
    const [dirPath, fileName] = splitPath(path);
    let dir = opfsRoot;
    for (const part of dirPath) dir = await dir.getDirectoryHandle(part, { create: true });
    const fh = await dir.getFileHandle(fileName, { create: true });
    const w = await fh.createWritable();
    await w.write(typeof obj === 'string' ? obj : JSON.stringify(obj));
    await w.close();
}

async function opfsRead(path) {
    const [dirPath, fileName] = splitPath(path);
    let dir = opfsRoot;
    for (const part of dirPath) dir = await dir.getDirectoryHandle(part, { create: false });
    const fh = await dir.getFileHandle(fileName, { create: false });
    const file = await fh.getFile();
    const text = await file.text();
    return text.length ? JSON.parse(text) : null;
}

async function opfsDelete(path) {
    const [dirPath, fileName] = splitPath(path);
    let dir = opfsRoot;
    for (const part of dirPath) dir = await dir.getDirectoryHandle(part, { create: false });
    await dir.removeEntry(fileName);
}

async function opfsList(dirPath) {
    // dirPath is a string like 'chat/contacts' — split it; iterating the string
    // itself walks per-CHARACTER handles and throws NotFoundError.
    const parts = dirPath.split('/').filter(Boolean);
    let dir = opfsRoot;
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: false });
    const names = [];
    for await (const [name] of dir.entries()) names.push(name);
    return names;
}

/* ---------- Node FS primitives (chat-db mode 'nodefs', desktop agents) ---------- */

// Keyring record ids contain ':' (e.g. 'peer_profile:static'). On Windows a ':'
// in a filename creates an NTFS alternate data stream instead of a file, which
// makes readdir unable to see the record and silently breaks list/clear.
// Filenames are sanitized; the TRUE id lives inside the record itself.
const winSafeFile = name => String(name).replace(/:/g, '+');

async function nodefsWrite(path, obj) {
    const fs = await import('node:fs/promises');
    const parts = path.split('/');
    const fileName = parts.pop();
    const dirPath = parts.join('/');
    const full = `${nodefsRoot}/${dirPath}`;
    await fs.mkdir(full, { recursive: true });
    await fs.writeFile(`${full}/${winSafeFile(fileName)}.json`, JSON.stringify(obj), 'utf8');
}

async function nodefsRead(path) {
    const fs = await import('node:fs/promises');
    const parts = path.split('/');
    const fileName = winSafeFile(parts.pop());
    const text = await fs.readFile(`${nodefsRoot}/${[...parts, fileName].join('/')}.json`, 'utf8');
    return text.length ? JSON.parse(text) : null;
}

async function nodefsDelete(path) {
    const fs = await import('node:fs/promises');
    const parts = path.split('/');
    const fileName = winSafeFile(parts.pop());
    await fs.unlink(`${nodefsRoot}/${[...parts, fileName].join('/')}.json`);
}

async function nodefsList(dirPath) {
    const fs = await import('node:fs/promises');
    const names = await fs.readdir(`${nodefsRoot}/${dirPath}`);
    return names;
}

function splitPath(path) {
    const parts = path.split('/');
    const fileName = parts.pop();
    return [parts, fileName];
}

/* ---------- IndexedDB primitives ---------- */

function idbTx(store, mode, fn) {
    return new Promise((resolve, reject) => {
        const tx = idb.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(req && req.result);
        tx.onerror = () => reject(tx.error);
    });
}

async function idbPut(store, value) { return idbTx(store, 'readwrite', s => s.put(value)); }
async function idbGet(store, id) { return idbTx(store, 'readonly', s => s.get(id)); }
async function idbGetAll(store) { return idbTx(store, 'readonly', s => s.getAll()); }
async function idbDelete(store, id) { return idbTx(store, 'readwrite', s => s.delete(id)); }

/* ---------- Unified record access ---------- */

// Record ids become filesystem path components in the OPFS and nodefs backends
// (`<store>/<id>.json`). Some ids originate outside the vault: a peer invite's
// `identityId` (core/peer.js acceptPeerContact) and a relay envelope's
// `messageId` (pollPeerInbox). Neither is trusted, so every id that reaches a
// backend is validated here — the storage layer is the last line of defence
// against path traversal (pentest finding F-02). Legitimate ids (uids, `peer_*`,
// uuid-derived, `store:key`) contain no separators and pass untouched.
function assertRecordId(id) {
    const s = String(id ?? '');
    if (!s || s.length > 200 || s.includes('/') || s.includes('\\') || s.includes('\u0000') ||
        s === '.' || s === '..' || s.includes('..')) {
        throw new Error(`chat-db: unsafe record id rejected (${JSON.stringify(s.slice(0, 40))})`);
    }
    return s;
}

function serialize(keyObj) {
    // Ensure ciphertext/iv/publicKey survive JSON (ArrayBuffer/TypedArray -> arrays)
    const out = {};
    for (const [k, v] of Object.entries(keyObj)) {
        if (v instanceof Uint8Array) out[k] = Array.from(v);
        else if (v instanceof ArrayBuffer) out[k] = Array.from(new Uint8Array(v));
        else out[k] = v;
    }
    return out;
}

async function putRecord(kind, record) {
    await ensureInit();
    assertRecordId(record?.id);
    const rec = serialize(record);
    if (mode === 'opfs') return opfsWrite(`chat/${kind}/${rec.id}.json`, rec);
    if (mode === 'indexeddb') return idbPut(kind, rec);
    if (mode === 'nodefs') return nodefsWrite(`${kind}/${rec.id}`, rec);
    memory[kind].set(rec.id, rec);
}

async function getRecord(kind, id) {
    await ensureInit();
    assertRecordId(id);
    if (mode === 'opfs') {
        try { return await opfsRead(`chat/${kind}/${id}.json`); }
        catch (err) { if (err?.name === 'NotFoundError') return null; throw err; }
    }
    if (mode === 'indexeddb') return idbGet(kind, id);
    if (mode === 'nodefs') {
        try { return await nodefsRead(`${kind}/${id}`); }
        catch (err) { if (err?.code === 'ENOENT') return null; throw err; }
    }
    return memory[kind].get(id) || null;
}

async function getAllRecords(kind) {
    await ensureInit();
    if (mode === 'opfs') {
        const names = await opfsList(`chat/${kind}`);
        const out = [];
        for (const name of names) {
            if (!name.endsWith('.json')) continue;
            try {
                out.push(await opfsRead(`chat/${kind}/${name}`));
            } catch (err) {
                // A transient OPFS read must not silently drop a record (a skipped
                // contact makes pollPeerInbox ack-and-drop real mail). Retry once.
                try {
                    const rec = await opfsRead(`chat/${kind}/${name}`);
                    out.push(rec);
                } catch (err2) { log('warn', `Failed to read ${kind}/${name} after retry`, err2); }
            }
        }
        return out;
    }
    if (mode === 'indexeddb') return idbGetAll(kind);
    if (mode === 'nodefs') {
        const names = await nodefsList(kind);
        const out = [];
        for (const name of names) {
            if (!name.endsWith('.json')) continue;
            try {
                out.push(await nodefsRead(`${kind}/${name.replace(/\.json$/, '')}`));
            } catch (err) {
                try {
                    const rec = await nodefsRead(`${kind}/${name.replace(/\.json$/, '')}`);
                    out.push(rec);
                } catch (err2) { log('warn', `Failed to read ${kind}/${name} after retry`, err2); }
            }
        }
        return out;
    }
    return [...memory[kind].values()];
}

async function deleteRecord(kind, id) {
    await ensureInit();
    assertRecordId(id);
    if (mode === 'opfs') return opfsDelete(`chat/${kind}/${id}.json`);
    if (mode === 'indexeddb') return idbDelete(kind, id);
    if (mode === 'nodefs') return nodefsDelete(`${kind}/${id}`);
    memory[kind].delete(id);
}

/* ================= Public API ================= */

export async function saveContact({ id, name, publicKey, createdAt, peer, meta, vaultKey }) {
    if (!id || !name) throw new Error('saveContact: id and name are required');
    const record = { id, name, publicKey, createdAt: createdAt || Date.now() };
    if (peer) record.peer = peer;
    if (meta) {
        const validation = validateContactMeta(meta);
        if (!validation.valid) throw new Error(`saveContact: ${validation.error}`);
        if (!vaultKey) throw new Error('saveContact: vaultKey required for metadata encryption');
        record.meta = await sealContactMeta(vaultKey, meta);
    }
    await putRecord('contacts', record);
}

export async function deleteContact(id) {
    await deleteRecord('contacts', id);
}

/**
 * Merge two contacts into one. The survivor keeps its identity, publicKey, and
 * peer relationship metadata. Metadata from the discarded contact is merged
 * (deduplicated arrays, survivor takes precedence on conflicts).
 *
 * @param {Object} options - Merge options
 * @param {string} options.survivorId - Contact ID to keep
 * @param {string} options.discardedId - Contact ID to remove
 * @param {Object} [options.vaultKey] - Vault key used to decrypt/discarded meta
 * @returns {Object} The merged survivor contact record (metadata decrypted)
 */
export async function mergeContacts({ survivorId, discardedId, vaultKey }) {
    if (!survivorId || !discardedId) throw new Error('mergeContacts: survivorId and discardedId are required');
    if (survivorId === discardedId) throw new Error('mergeContacts: survivor and discarded contact must differ');

    const survivor = await getRecord('contacts', survivorId);
    const discarded = await getRecord('contacts', discardedId);
    if (!survivor) throw new Error('mergeContacts: survivor not found');
    if (!discarded) throw new Error('mergeContacts: discarded contact not found');

    let survivorMeta = survivor.meta;
    let discardedMeta = null;
    if (vaultKey && survivor.meta) {
        survivorMeta = await openContactMeta(vaultKey, survivor.meta);
    }
    if (vaultKey && discarded.meta) {
        discardedMeta = await openContactMeta(vaultKey, discarded.meta);
    }
    const mergedMeta = mergeContactMeta(survivorMeta || {}, discardedMeta || {});

    const merged = { ...survivor };
    if (Object.keys(mergedMeta).length > 0) {
        merged.meta = await sealContactMeta(vaultKey, mergedMeta);
    } else if (merged.meta) {
        delete merged.meta;
    }
    await putRecord('contacts', merged);

    const allConvs = await getAllRecords('conversations');
    let migratedConversations = 0;
    for (const conv of allConvs) {
        if (conv.contactId === discardedId) {
            await putRecord('conversations', { ...conv, contactId: survivorId });
            migratedConversations += 1;
        }
    }

    await deleteRecord('contacts', discardedId);

    // Append-only audit trail for the merge. Stores local record ids and field
    // names only — never decrypted PII values.
    await putRecord('contact_merge_log', {
        id: `merge_${survivorId}_${discardedId}_${Date.now()}`,
        survivorId,
        discardedId,
        survivorName: survivor.name || null,
        discardedName: discarded.name || null,
        migratedConversations,
        mergedFields: Object.keys(mergedMeta),
        timestamp: Date.now()
    });

    const survivorRecord = await getRecord('contacts', survivorId);
    if (vaultKey && survivorRecord?.meta) {
        survivorRecord.meta = await openContactMeta(vaultKey, survivorRecord.meta);
    }
    return survivorRecord;
}

/**
 * Read the append-only contact-merge audit trail, newest first.
 * @returns {Array<Object>} Merge audit records (no PII values).
 */
export async function getContactMergeLog() {
    const all = await getAllRecords('contact_merge_log');
    return all.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

/* ---------- Keyring (relationship private material, sealed at rest) ---------- */

export async function getAllKeyringEntries() {
    return getAllRecords('keyring');
}

export async function saveKeyringEntry({ id, sealed, meta }) {
    if (!id || (!sealed && !meta)) throw new Error('saveKeyringEntry: id and sealed or meta are required');
    const record = { id };
    if (sealed) record.sealed = { ciphertext: Array.from(sealed.ciphertext), iv: Array.from(sealed.iv), algorithm: sealed.algorithm };
    if (meta) record.meta = meta;
    await putRecord('keyring', record);
}

export async function getKeyringEntry(id) {
    return getRecord('keyring', id);
}

export async function deleteKeyringEntry(id) {
    return deleteRecord('keyring', id);
}

export async function getAllContacts(vaultKey) {
    const all = await getAllRecords('contacts');
    if (vaultKey) {
        for (const contact of all) {
            if (contact.meta) {
                contact.meta = await openContactMeta(vaultKey, contact.meta);
            }
        }
    }
    return all.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

/**
 * Direct contact read by deterministic id (`peer_<identityId>`). Single-file
 * OPFS read with a much smaller race surface than a full directory scan, so
 * inbox routing should prefer this over scanning the whole contact list.
 */
export async function getContact(id, vaultKey) {
    if (!id) return null;
    const contact = await getRecord('contacts', id);
    if (contact && contact.meta && vaultKey) {
        contact.meta = await openContactMeta(vaultKey, contact.meta);
    }
    return contact;
}

export async function saveConversation({ id, name, contactId, lastActivity }) {
    if (!id || !name || !contactId) throw new Error('saveConversation: id, name, contactId required');
    await putRecord('conversations', {
        id, name, contactId,
        lastMessage: '', lastActivity: lastActivity || Date.now()
    });
}

export async function getConversation(id) {
    return getRecord('conversations', id);
}

export async function getAllConversations() {
    const all = await getAllRecords('conversations');
    return all.sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));
}

export async function saveMessage({ id, conversationId, sender, ciphertext, iv, mimeType, timestamp, status }) {
    if (!id || !conversationId) throw new Error('saveMessage: id and conversationId are required');
    await putRecord('messages', {
        id, conversationId, sender,
        ciphertext, iv,
        mimeType: mimeType || 'text/plain',
        timestamp: timestamp || Date.now(),
        status: status || 'sent'
    });
    const conv = await getRecord('conversations', conversationId);
    if (conv) {
        // Zero-knowledge preview: the DB never stores plaintext chat content.
        conv.lastMessage = '[encrypted]';
        conv.lastActivity = timestamp || Date.now();
        await putRecord('conversations', conv);
    }
}

export async function getMessages(conversationId) {
    const all = await getAllRecords('messages');
    return all
        .filter(m => m.conversationId === conversationId)
        .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
}

export async function deleteConversation(id) {
    const msgs = await getAllRecords('messages');
    for (const m of msgs) {
        if (m.conversationId === id) await deleteRecord('messages', m.id);
    }
    await deleteRecord('conversations', id);
}

/** Remove a single message record (used by send-retry to replace failed mail). */
export async function deleteMessage(id) {
    return deleteRecord('messages', id);
}

export async function generateKeyPair() {
    return generateECDHKeyPair();
}

export async function exportPublicKey(keyPairOrKey) {
    const pk = keyPairOrKey && keyPairOrKey.publicKey ? keyPairOrKey.publicKey : keyPairOrKey;
    return cryptoExportPublicKey(pk);
}

export { cryptoEncrypt as encryptData, cryptoDecrypt as decryptData };

/** Message-encryption aliases (same AES-256-GCM engine, message semantics). */
export const encryptMessage = cryptoEncrypt;
export const decryptMessage = cryptoDecrypt;

/* ---------- Encrypted attachments (isolated store) ---------- */

export async function saveAttachment({ id, conversationId, name, mimeType, ciphertext, iv, timestamp }) {
    if (!id || !conversationId) throw new Error('saveAttachment: id and conversationId are required');
    await putRecord('attachments', {
        id, conversationId,
        name: name || 'attachment',
        mimeType: mimeType || 'application/octet-stream',
        ciphertext, iv,
        timestamp: timestamp || Date.now()
    });
}

export async function getAttachments(conversationId) {
    const all = await getAllRecords('attachments');
    return all.filter(a => a.conversationId === conversationId)
        .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
}

export async function deleteAttachment(id) {
    await deleteRecord('attachments', id);
}

export function getChatDBMode() { return mode; }
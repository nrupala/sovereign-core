// Copyright (c) 2026 2351485 ALBERTA INC. SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';

// Phase 1 store-interface tests (spec §5, §11 R-1/R-2; spike report §3).
// The trial engine is core/db.js (OPFS primary, IndexedDB fallback). Node
// has neither, so this file installs a minimal in-memory IndexedDB shim
// BEFORE importing the store — the same polyfill-first pattern as
// core/scrubber.test.js. With no navigator.storage.getDirectory, db.js
// falls back to IndexedDB mode, which the shim serves.

function fakeRequest() {
    return { result: undefined, error: null, onsuccess: null, onerror: null };
}
function succeed(req, result) {
    req.result = result;
    Promise.resolve().then(() => { if (req.onsuccess) req.onsuccess(); });
}
class FakeObjectStore {
    constructor(keyPath) { this.keyPath = keyPath; this.records = new Map(); }
    get(key) { const r = fakeRequest(); succeed(r, this.records.get(key)); return r; }
    getAll() { const r = fakeRequest(); succeed(r, [...this.records.values()]); return r; }
    put(value) { const r = fakeRequest(); this.records.set(value[this.keyPath], value); succeed(r, undefined); return r; }
    delete(key) { const r = fakeRequest(); this.records.delete(key); succeed(r, undefined); return r; }
}
class FakeDB {
    constructor() {
        this.stores = new Map();
        this.objectStoreNames = { contains: (n) => this.stores.has(n) };
    }
    createObjectStore(name, { keyPath }) {
        const s = new FakeObjectStore(keyPath);
        this.stores.set(name, s);
        return s;
    }
    transaction(name) {
        const s = this.stores.get(name);
        return { objectStore: () => s };
    }
}
const fakeDB = new FakeDB();
globalThis.indexedDB = {
    open() {
        const req = fakeRequest();
        req.result = fakeDB;
        Promise.resolve().then(() => {
            if (req.onupgradeneeded) req.onupgradeneeded();
            if (req.onsuccess) req.onsuccess();
        });
        return req;
    }
};

const { createTrialStore, STORE_METHODS } = await import('./store.js');
const { createEnvelope } = await import('./keys.js');
const { encryptData, decryptData } = await import('./crypto.js');

const store = createTrialStore();
const PASSWORD = 'store test passphrase';

async function makeVault(id) {
    const { envelope, dek } = await createEnvelope(PASSWORD);
    const record = { id, name: `Vault ${id}`, ...envelope };
    await store.createVault(record);
    return { record, dek };
}

async function putEncrypted(vaultId, dek, itemId, plaintext) {
    const { ciphertext, iv } = await encryptData(dek, plaintext);
    await store.putItem(vaultId, { id: itemId, blob: ciphertext, iv });
}

test('trial store implements the full contract surface', async () => {
    for (const m of STORE_METHODS) {
        assert.equal(typeof store[m], 'function', `store.${m} is a function`);
    }
    const info = await store.init();
    assert.equal(info.engine, 'trial');
    assert.equal(info.mode, 'indexeddb'); // shimmed fallback in Node
});

test('vault record round-trips with its envelope fields intact', async () => {
    const { record } = await makeVault('v-record');
    const got = await store.getVault('v-record');
    assert.ok(got);
    assert.equal(got.formatVersion, 2);
    assert.deepEqual(got.passwordWrap, record.passwordWrap);
    assert.deepEqual(got.recoveryWrap, record.recoveryWrap);
    assert.deepEqual(Array.from(got.salt), record.salt);
    const all = await store.listVaults();
    assert.ok(all.some(v => v.id === 'v-record'));
    assert.equal(await store.getVault('v-missing'), null);
});

test('item CRUD round-trip on the trial engine, encrypted end to end', async () => {
    const { dek } = await makeVault('v-crud');
    await putEncrypted('v-crud', dek, 'item-1', 'first sealed note');
    await putEncrypted('v-crud', dek, 'item-2', 'second sealed note');

    const got = await store.getItem('v-crud', 'item-1');
    assert.ok(got);
    assert.equal(await decryptData(dek, got.blob, got.iv), 'first sealed note');

    const list = await store.listItems('v-crud');
    assert.deepEqual(list.map(i => i.id).sort(), ['item-1', 'item-2']);

    await store.deleteItem('v-crud', 'item-1');
    assert.equal(await store.getItem('v-crud', 'item-1'), null);
    assert.deepEqual((await store.listItems('v-crud')).map(i => i.id), ['item-2']);
});

test('items are scoped per vault, and deleteVault removes only its own', async () => {
    const a = await makeVault('v-iso-a');
    const b = await makeVault('v-iso-b');
    await putEncrypted('v-iso-a', a.dek, 'shared-id', 'vault A secret');
    await putEncrypted('v-iso-b', b.dek, 'shared-id', 'vault B secret');

    assert.equal((await store.listItems('v-iso-a')).length, 1);
    assert.equal((await store.listItems('v-iso-b')).length, 1);
    const gotB = await store.getItem('v-iso-b', 'shared-id');
    assert.equal(await decryptData(b.dek, gotB.blob, gotB.iv), 'vault B secret');

    await store.deleteVault('v-iso-a');
    assert.equal(await store.getVault('v-iso-a'), null);
    assert.deepEqual(await store.listItems('v-iso-a'), []);
    assert.equal((await store.listItems('v-iso-b')).length, 1);
});

test('searchItems matches over decrypted content, in memory only', async () => {
    const { dek } = await makeVault('v-search');
    await putEncrypted('v-search', dek, 's1', 'Budget review for October');
    await putEncrypted('v-search', dek, 's2', 'Dentist appointment Tuesday');
    const decryptFn = (item) => decryptData(dek, item.blob, item.iv);

    const hits = await store.searchItems('v-search', 'budget', decryptFn);
    assert.deepEqual(hits.map(i => i.id), ['s1']);
    assert.deepEqual(await store.searchItems('v-search', 'nonexistent', decryptFn), []);
    assert.deepEqual(await store.searchItems('v-search', '', decryptFn), []);
});

test('backup hooks: export → import as a new vault, items intact', async () => {
    const { dek } = await makeVault('v-backup-src');
    await putEncrypted('v-backup-src', dek, 'b1', 'backed up and sealed');

    const data = await store.exportVaultData('v-backup-src');
    assert.ok(data && data.vault && data.items.length === 1);
    assert.equal(await store.exportVaultData('v-missing'), null);

    // Restoring under the SAME id is refused (spec §6: restore lands as a
    // new vault beside existing ones; renaming is the caller's job).
    await assert.rejects(() => store.importVaultData(data), /already exists/);

    const restored = { ...data, vault: { ...data.vault, id: 'v-backup-dst' } };
    const result = await store.importVaultData(restored);
    assert.deepEqual(result, { vaultId: 'v-backup-dst', itemCount: 1 });
    const got = await store.getItem('v-backup-dst', 'b1');
    assert.equal(await decryptData(dek, got.blob, got.iv), 'backed up and sealed');
});

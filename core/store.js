// Copyright (c) 2026 2351485 ALBERTA INC. SPDX-License-Identifier: MIT
/**
 * Sovereign Core — Phase 1 shared store interface (spec §5, §11 R-1/R-2;
 * spike report §3: "the store interface must be enforced from the first
 * Phase 1 commit or the engines drift").
 *
 * Two engines sit behind this ONE contract, chosen by tier:
 *   - trial engine: today's OPFS/IndexedDB store (core/db.js), for the
 *     free-forever tier (spec §11 R-1). Implemented here as a thin adapter.
 *   - paid engine: the encrypted SQLite base (spike route), a later
 *     workstream. It MUST implement this same contract.
 *
 * Migration (spec §7, §11 R-2) is then a copy job between two stores:
 * read every item from one, write it to the other.
 *
 * THE CONTRACT (every engine implements every method):
 *
 *   init()                          → { engine, mode } once storage is ready
 *   createVault(record)             → record   (record: spec §5 vault record —
 *                                     id, name, salt, kdf, passwordWrap,
 *                                     recoveryWrap, verifier, formatVersion,
 *                                     createdAt; all JSON-safe values)
 *   listVaults()                    → [record, …] newest first
 *   getVault(vaultId)               → record | null
 *   deleteVault(vaultId)            → void (vault record + all its items)
 *
 *   putItem(vaultId, item)          → item     (item: { id, blob, iv } —
 *                                     blob is the item ciphertext (ArrayBuffer),
 *                                     iv its AES-GCM IV (Uint8Array); ALL
 *                                     metadata lives inside the encrypted
 *                                     blob per spec §5, never beside it)
 *   getItem(vaultId, itemId)        → { id, blob, iv, createdAt, updatedAt } | null
 *   listItems(vaultId)              → [item, …] newest first, this vault only
 *   deleteItem(vaultId, itemId)     → void
 *
 *   searchItems(vaultId, query, decryptFn)
 *                                   → [item, …] whose DECRYPTED content
 *                                     matches query (case-insensitive
 *                                     substring). Search is in-memory over
 *                                     decrypted content only (spec §4,
 *                                     binding): decryptFn(item) is supplied
 *                                     by the app layer, which holds the DEK;
 *                                     it returns the item's plaintext string
 *                                     or null to skip the item. The store
 *                                     never sees a key and never persists
 *                                     plaintext or a plaintext index.
 *
 *   exportVaultData(vaultId)        → { formatVersion, vault, items } — the
 *                                     raw encrypted material the .scvault
 *                                     bundle builder (spec §6) seals. This
 *                                     layer does not define the bundle format.
 *   importVaultData(data)           → { vaultId, itemCount } — persists a
 *                                     vault record + items from
 *                                     exportVaultData's shape. Throws if the
 *                                     vault id already exists: restore-as-new
 *                                     naming (spec §6) is the caller's job.
 *
 *   getSetting(key) / setSetting(key, value)
 *                                   → per spec §5 these are the COSMETIC
 *                                     settings (theme/display — nothing about
 *                                     content). Private per-vault settings
 *                                     are items under the DEK, not settings.
 *
 * Item ids are unique per vault; engines may namespace internally
 * (the trial engine prefixes with the vault id, as core/db.js already does).
 */

import {
    initSovereignDB, getDBMode,
    saveVault, getAllVaults, deleteVault as dbDeleteVault,
    saveVessel, getVesselById, getAllVessels, deleteVessel,
    getSetting as dbGetSetting, setSetting as dbSetSetting
} from './db.js';

export const STORE_CONTRACT_VERSION = 1;

export const STORE_METHODS = [
    'init', 'createVault', 'listVaults', 'getVault', 'deleteVault',
    'putItem', 'getItem', 'listItems', 'deleteItem', 'searchItems',
    'exportVaultData', 'importVaultData', 'getSetting', 'setSetting'
];

/* ── trial engine: core/db.js (OPFS primary, IndexedDB fallback) ── */

function fullItemId(vaultId, itemId) {
    // core/db.js namespaces vessels by vault prefix (its deleteVault
    // already removes every vessel whose id starts with `${vaultId}_`).
    return `${vaultId}_${itemId}`;
}

function normalizeItem(vaultId, row) {
    if (!row) return null;
    const prefix = `${vaultId}_`;
    return {
        id: row.id.startsWith(prefix) ? row.id.slice(prefix.length) : row.id,
        blob: row.blob instanceof ArrayBuffer ? row.blob : new Uint8Array(row.blob).buffer,
        iv: row.iv instanceof Uint8Array ? row.iv : new Uint8Array(row.iv),
        createdAt: row.timestamp || 0,
        updatedAt: row.updatedAt || row.timestamp || 0
    };
}

/**
 * The trial store: today's engine behind the contract. Thin by design —
 * every method delegates to core/db.js; no db.js behaviour is changed
 * (saveVault gained only an optional extra-fields parameter, used here
 * to persist the v2 envelope fields of the spec §5 vault record).
 */
export function createTrialStore() {
    return {
        engine: 'trial',

        async init() {
            await initSovereignDB();
            return { engine: 'trial', mode: getDBMode() };
        },

        async createVault(record) {
            const { id, name, salt, verifier, ...extra } = record;
            await saveVault(id, name, salt, verifier || null, extra);
            return record;
        },

        async listVaults() {
            return getAllVaults();
        },

        async getVault(vaultId) {
            const all = await getAllVaults();
            return all.find(v => v.id === vaultId) || null;
        },

        async deleteVault(vaultId) {
            await dbDeleteVault(vaultId);
        },

        async putItem(vaultId, item) {
            // Legacy .meta fields are passed as inert defaults: in the v2
            // model all metadata lives inside the encrypted blob (spec §5),
            // and the trial engine's plaintext .meta carries nothing about
            // content from this layer. (The .meta file itself disappears
            // with the engine migration; removing it here would rewrite
            // db.js, which this workstream deliberately does not do.)
            await saveVessel(fullItemId(vaultId, item.id), item.blob, item.iv,
                '', [], 'medium', 'none', false);
            return item;
        },

        async getItem(vaultId, itemId) {
            return normalizeItem(vaultId, await getVesselById(fullItemId(vaultId, itemId)));
        },

        async listItems(vaultId) {
            const all = await getAllVessels();
            return all
                .filter(r => r.id.startsWith(`${vaultId}_`))
                .map(r => normalizeItem(vaultId, r));
        },

        async deleteItem(vaultId, itemId) {
            await deleteVessel(fullItemId(vaultId, itemId));
        },

        async searchItems(vaultId, query, decryptFn) {
            const q = String(query || '').toLowerCase();
            if (!q) return [];
            const matches = [];
            for (const item of await this.listItems(vaultId)) {
                let text = null;
                try { text = await decryptFn(item); } catch { text = null; }
                if (typeof text === 'string' && text.toLowerCase().includes(q)) {
                    matches.push(item);
                }
            }
            return matches;
        },

        async exportVaultData(vaultId) {
            const vault = await this.getVault(vaultId);
            if (!vault) return null;
            const items = await this.listItems(vaultId);
            return { formatVersion: vault.formatVersion || 1, vault, items };
        },

        async importVaultData(data) {
            if (!data || !data.vault || !data.vault.id) throw new Error('importVaultData: missing vault record');
            const existing = await this.getVault(data.vault.id);
            if (existing) throw new Error(`importVaultData: vault ${data.vault.id} already exists`);
            await this.createVault(data.vault);
            let itemCount = 0;
            for (const item of data.items || []) {
                await this.putItem(data.vault.id, item);
                itemCount++;
            }
            return { vaultId: data.vault.id, itemCount };
        },

        async getSetting(key) {
            return dbGetSetting(key);
        },

        async setSetting(key, value) {
            await dbSetSetting(key, value);
        }
    };
}

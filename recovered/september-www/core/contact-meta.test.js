import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptContactMeta, decryptContactMeta, sealContactMeta, openContactMeta, validateContactMeta, mergeContactMeta, contactMetaSnippet } from './contact-meta.js';
import { saveContact, getAllContacts, mergeContacts, deleteContact, saveConversation, getContactMergeLog } from './chat-db.js';

async function vaultKey() {
    return crypto.subtle.importKey('raw', crypto.getRandomValues(new Uint8Array(32)), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

test('seal/open round-trip preserves full contact metadata', async () => {
    const key = await vaultKey();
    const meta = {
        phone: [{ label: 'mobile', value: '+1 555 0100' }],
        email: [{ label: 'work', value: 'a@example.com' }],
        organization: [{ label: 'company', value: 'Acme Inc.' }],
        address: [{ label: 'home', value: '1 Main St' }],
        notes: 'met at conference',
        groups: ['work'],
        labels: ['priority']
    };
    const sealed = await sealContactMeta(key, meta);
    assert.ok(sealed.ciphertext.length > 0, 'ciphertext must be present');
    assert.ok(sealed.iv.length > 0, 'iv must be present');
    assert.equal(sealed.version, 1);
    const opened = await openContactMeta(key, sealed);
    assert.deepEqual(opened, meta);
    assert.notEqual(sealed.ciphertext, undefined);
    const raw = JSON.stringify(sealed.ciphertext);
    assert.ok(!raw.includes('+1 555 0100'), 'plaintext PII must not be in the sealed blob');
});

test('wrong vault key yields null (fail closed on metadata)', async () => {
    const key = await vaultKey();
    const wrong = await vaultKey();
    const sealed = await sealContactMeta(key, { phone: [{ label: 'mobile', value: '+1 999 0000' }] });
    assert.equal(await openContactMeta(wrong, sealed), null);
});

test('encrypt/decrypt primitives round-trip', async () => {
    const key = await vaultKey();
    const enc = await encryptContactMeta(key, { notes: 'secret' });
    const dec = await decryptContactMeta(key, enc);
    assert.deepEqual(dec, { notes: 'secret' });
});

test('validateContactMeta rejects disallowed keys and wrong types', () => {
    assert.deepEqual(validateContactMeta(null), { valid: false, error: 'metadata must be an object' });
    assert.equal(validateContactMeta({ ssn: '123' }).valid, false);
    assert.equal(validateContactMeta({ phone: 'not-array' }).valid, false);
    assert.equal(validateContactMeta({ notes: 42 }).valid, false);
    assert.equal(validateContactMeta({ phone: [], email: [], address: [], organization: [], groups: [], labels: [], notes: '', photo: '' }).valid, true);
});

test('mergeContactMeta deduplicates and prefers survivor', () => {
    const a = { phone: [{ label: 'mobile', value: '1' }], email: [{ label: 'work', value: 'a@x.com' }], notes: 'survivor note' };
    const b = { phone: [{ label: 'mobile', value: '1' }, { label: 'home', value: '2' }], email: [{ label: 'home', value: 'b@x.com' }], notes: 'discarded note' };
    const merged = mergeContactMeta(a, b);
    assert.equal(merged.phone.length, 2, 'phone dedupes to 2');
    assert.equal(merged.email.length, 2, 'emails combine');
    assert.equal(merged.notes, 'survivor note', 'survivor notes take precedence');
});

test('contactMetaSnippet masks phone and email', () => {
    const s = contactMetaSnippet({ phone: [{ label: 'mobile', value: '+1 555 0100' }], email: [{ label: 'work', value: 'alice@example.com' }] });
    assert.ok(!s.includes('0100'), 'phone should be masked');
    assert.ok(!s.includes('alice@'), 'email should be masked');
    assert.ok(s.includes('@'), 'email domain demo remains');
    assert.ok(s.includes('15***00'), 'phone shows only head and tail digits');
});

test('saveContact stores ciphertext and getAllContacts decrypts', async () => {
    const key = await vaultKey();
    const raw = { phone: [{ label: 'mobile', value: '+1 555 0100' }] };
    await saveContact({ id: 'contact_test1', name: 'Zed', createdAt: 1, meta: raw, vaultKey: key });
    const list = await getAllContacts(key);
    const zed = list.find(c => c.id === 'contact_test1');
    assert.ok(zed, 'contact must exist');
    assert.ok(zed.meta && zed.meta.phone, 'meta must be decrypted on read');
    assert.equal(zed.meta.phone[0].value, '+1 555 0100');
    await deleteContact('contact_test1');
});

test('mergeContacts combines metadata and redirects survivors', async () => {
    const key = await vaultKey();
    await saveContact({ id: 'contact_survivor', name: 'Keep', createdAt: 2, meta: { phone: [{ label: 'mobile', value: '111' }] }, vaultKey: key });
    await saveContact({ id: 'contact_discarded', name: 'Drop', createdAt: 3, meta: { email: [{ label: 'work', value: 'drop@x.com' }], notes: 'old note' }, vaultKey: key });

    const merged = await mergeContacts({ survivorId: 'contact_survivor', discardedId: 'contact_discarded', vaultKey: key });
    assert.equal(merged.meta.phone[0].value, '111', 'survivor phone kept');
    assert.equal(merged.meta.email[0].value, 'drop@x.com', 'discarded email merged in');

    const list = await getAllContacts(key);
    assert.equal(list.find(c => c.id === 'contact_discarded'), undefined, 'discarded contact removed');
    assert.ok(list.find(c => c.id === 'contact_survivor'), 'survivor remains');
    await deleteContact('contact_survivor');
});

test('mergeContacts fails when ids are missing or equal', async () => {
    const key = await vaultKey();
    await saveContact({ id: 'contact_merge_a', name: 'A', createdAt: 4 });
    await saveContact({ id: 'contact_merge_b', name: 'B', createdAt: 5 });
    await assert.rejects(() => mergeContacts({ survivorId: 'contact_merge_a', discardedId: 'contact_merge_a', vaultKey: key }), /must differ/);
    await assert.rejects(() => mergeContacts({ survivorId: null, discardedId: 'contact_merge_b', vaultKey: key }), /required/);
    await deleteContact('contact_merge_a');
    await deleteContact('contact_merge_b');
});

test('mergeContacts writes an append-only audit trail with no PII values', async () => {
    const key = await vaultKey();
    await saveContact({ id: 'contact_audit_keep', name: 'Keep', createdAt: 6, meta: { phone: [{ label: 'mobile', value: '+1 555 0177' }] }, vaultKey: key });
    await saveContact({ id: 'contact_audit_drop', name: 'Drop', createdAt: 7, meta: { email: [{ label: 'work', value: 'audit@x.com' }] }, vaultKey: key });
    await saveConversation({ id: 'conv_audit_1', name: 'chat', contactId: 'contact_audit_drop' });

    await mergeContacts({ survivorId: 'contact_audit_keep', discardedId: 'contact_audit_drop', vaultKey: key });

    const log = await getContactMergeLog();
    const entry = log.find(e => e.survivorId === 'contact_audit_keep' && e.discardedId === 'contact_audit_drop');
    assert.ok(entry, 'merge must be audited');
    assert.equal(entry.migratedConversations, 1, 'counts migrated conversations');
    assert.ok(entry.mergedFields.includes('phone') && entry.mergedFields.includes('email'), 'records merged field names');
    assert.ok(!JSON.stringify(entry).includes('+1 555 0177'), 'audit trail must not contain PII values');
    assert.ok(!JSON.stringify(entry).includes('audit@x.com'), 'audit trail must not contain PII values');
    await deleteContact('contact_audit_keep');
});
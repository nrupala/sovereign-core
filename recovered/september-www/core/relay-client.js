const randomId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

const MAX_TTL_SECONDS = 7 * 24 * 60 * 60;
const text = value => new TextEncoder().encode(value);
const base64url = bytes => {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
};
const randomCapability = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
const hashCapability = async value => base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', text(value))));

export async function createQueueCredentials({ ttlSeconds = MAX_TTL_SECONDS } = {}) {
    const createdAt = Date.now();
    const sendSecret = randomCapability();
    const receiveSecret = randomCapability();
    const expiresAt = createdAt + Math.min(Math.max(ttlSeconds, 60), MAX_TTL_SECONDS) * 1000;
    return {
        queueId: `q_${randomId().replaceAll('-', '')}`,
        sendCapability: await hashCapability(sendSecret),
        receiveCapability: await hashCapability(receiveSecret),
        sendSecret,
        receiveSecret,
        createdAt,
        expiresAt
    };
}

export function createEnvelope({ messageId = randomId(), ciphertext, header, iv, createdAt = Date.now(), expiresAt }) {
    if (typeof ciphertext !== 'string' || !ciphertext.length) throw new Error('ciphertext is required');
    if (typeof header !== 'object' || header === null) throw new Error('header is required');
    if (typeof iv !== 'string' || !iv.length) throw new Error('iv is required');
    return { version: 1, type: 'message', messageId, createdAt, expiresAt, header, ciphertext, iv };
}

export function mergeRelayMessages(...batches) {
    const messages = new Map();
    for (const batch of batches.flat()) {
        if (!batch || typeof batch.messageId !== 'string') continue;
        if (!messages.has(batch.messageId)) messages.set(batch.messageId, batch);
    }
    return [...messages.values()].sort((a, b) => a.createdAt - b.createdAt);
}

export function deliveryState({ primary, secondary }) {
    if (primary === 'delivered' || secondary === 'delivered') return 'delivered';
    if (primary === 'queued' || secondary === 'queued') return 'queued';
    if (primary === 'sending' || secondary === 'sending') return 'sending';
    if (primary === 'failed' && secondary === 'failed') return 'failed';
    return 'draft';
}

async function jsonRequest(url, options, bearer) {
    const headers = { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) };
    const response = await fetch(url, { ...options, headers });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`relay ${response.status}: ${body.error || response.statusText}`);
    return body;
}

export async function provisionRelayQueue(baseUrl, credentials) {
    if (!baseUrl || !credentials) throw new Error('provisionRelayQueue: baseUrl and credentials required');
    return jsonRequest(`${baseUrl}/v1/queues`, {
        method: 'POST',
        body: JSON.stringify({ queueId: credentials.queueId, sendCapability: credentials.sendSecret, receiveCapability: credentials.receiveSecret, ttlSeconds: MAX_TTL_SECONDS })
    });
}

export async function sendRelayMessage(baseUrl, queueId, sendSecret, envelope) {
    if (!baseUrl || !queueId || !sendSecret || !envelope?.messageId) throw new Error('sendRelayMessage: relay, queue, secret, and envelope.messageId required');
    return jsonRequest(`${baseUrl}/v1/queues/${queueId}/messages`, { method: 'POST', body: JSON.stringify(envelope) }, sendSecret);
}

export async function pullRelayMessages(baseUrl, queueId, receiveSecret) {
    if (!baseUrl || !queueId || !receiveSecret) throw new Error('pullRelayMessages: relay, queue, and receive secret required');
    return jsonRequest(`${baseUrl}/v1/queues/${queueId}/messages`, {}, receiveSecret);
}

export async function ackRelayMessage(baseUrl, queueId, receiveSecret, messageId) {
    if (!baseUrl || !queueId || !receiveSecret || !messageId) throw new Error('ackRelayMessage: relay, queue, secret, and messageId required');
    return jsonRequest(`${baseUrl}/v1/queues/${queueId}/messages/${encodeURIComponent(messageId)}`, { method: 'DELETE' }, receiveSecret);
}

export { MAX_TTL_SECONDS, hashCapability };

import { DurableObject } from 'cloudflare:workers';

const MAX_BODY = 256 * 1024;
const MAX_TTL = 7 * 24 * 60 * 60;
const queueIdPattern = /^[A-Za-z0-9_-]{16,128}$/;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS' } });
const capabilityHash = async value => { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(''); };
const authCapability = request => { const value = request.headers.get('authorization') || ''; return value.startsWith('Bearer ') ? value.slice(7) : ''; };

export class QueueMailbox extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS queue (send_hash TEXT PRIMARY KEY, receive_hash TEXT NOT NULL, expires_at INTEGER NOT NULL);');
    this.sql.exec('CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, body TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);');
  }

  async authorized(request, role) {
    try {
      const rows = [...this.sql.exec('SELECT send_hash, receive_hash, expires_at FROM queue LIMIT 1')];
      if (!rows.length) return false;
      if (rows[0].expires_at <= Date.now()) return false;
      const authVal = authCapability(request);
      if (!authVal) return false;
      const presented = await capabilityHash(authVal);
      const expected = role === 'send' ? rows[0].send_hash : rows[0].receive_hash;
      return presented === expected;
    } catch (e) {
      return false;
    }
  }

  async handleInternal(request) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/v1/queue') {
      let body;
      try { body = await request.json(); } catch { return json({ error: 'invalid queue request' }, 400); }
      if (typeof body.queueId !== 'string' || !queueIdPattern.test(body.queueId)) return json({ error: 'invalid queue id' }, 400);
      if (typeof body.sendCapability !== 'string' || typeof body.receiveCapability !== 'string') return json({ error: 'invalid queue request' }, 400);
      const sendHash = await capabilityHash(body.sendCapability);
      const receiveHash = await capabilityHash(body.receiveCapability);
      this.sql.exec('DELETE FROM queue');
      this.sql.exec('INSERT INTO queue (send_hash, receive_hash, expires_at) VALUES (?, ?, ?)', sendHash, receiveHash, Date.now() + (body.ttlSeconds || MAX_TTL) * 1000);
      return json({ accepted: true, expiresAt: Date.now() + (body.ttlSeconds || MAX_TTL) * 1000 }, 201);
    }
    if (url.pathname === '/v1/queue/messages' && request.method === 'POST') {
      const text = await request.text();
      let body;
      try { body = JSON.parse(text); } catch { return json({ error: 'invalid envelope' }, 400); }
      if (!body.messageId || typeof body.ciphertext !== 'string') return json({ error: 'invalid envelope' }, 400);
      const now = Date.now();
      const expiresAt = Math.min(Number(body.expiresAt || now + MAX_TTL * 1000), now + MAX_TTL * 1000);
      if (expiresAt <= now) return json({ error: 'invalid expiry' }, 400);
      if (text.length > MAX_BODY) return json({ error: 'body too large' }, 413);
      const authResult = await this.authorized(request, 'send');
      if (!authResult) return json({ error: 'forbidden' }, 403);
      this.sql.exec('INSERT OR IGNORE INTO messages (id, body, created_at, expires_at) VALUES (?, ?, ?, ?)', String(body.messageId), JSON.stringify(body), now, expiresAt);
      return json({ accepted: true, messageId: body.messageId }, 202);
    }
    if (url.pathname === '/v1/queue/messages' && request.method === 'GET') {
      if (!await this.authorized(request, 'receive')) return json({ error: 'forbidden' }, 403);
      const messages = [...this.sql.exec('SELECT body FROM messages WHERE expires_at > ? ORDER BY created_at LIMIT 50', Date.now())].map(row => JSON.parse(row.body));
      return json({ messages });
    }
    if (url.pathname.startsWith('/v1/queue/messages/') && request.method === 'DELETE') {
      if (!await this.authorized(request, 'receive')) return json({ error: 'forbidden' }, 403);
      let id; try { id = decodeURIComponent(url.pathname.slice('/v1/queue/messages/'.length)); } catch { return json({ error: 'invalid id' }, 400); }
      this.sql.exec('DELETE FROM messages WHERE id = ?', id);
      return json({ deleted: true });
    }
    return json({ error: 'not found' }, 404);
  }

  async fetch(request) {
    if (request.method === 'OPTIONS') return json({}, 204);
    this.sql.exec('DELETE FROM messages WHERE expires_at <= ?', Date.now());
    return this.handleInternal(request);
  }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS' } });
    const url = new URL(request.url);
    if (url.pathname === '/healthz') return json({ ok: true });
    if (url.pathname === '/v1/queues' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch { return json({ error: 'invalid queue id' }, 400); }
      if (typeof body.queueId !== 'string' || !queueIdPattern.test(body.queueId)) return json({ error: 'invalid queue id' }, 400);
      const id = env.QUEUE_MAILBOX.idFromName(body.queueId);
      const stub = env.QUEUE_MAILBOX.get(id);
      return stub.fetch('https://queue.internal/v1/queue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    }
    const match = url.pathname.match(/^\/v1\/queues\/([A-Za-z0-9_-]{16,128})(\/messages(?:\/.*)?)?$/);
    if (match) {
      const id = env.QUEUE_MAILBOX.idFromName(match[1]);
      const stub = env.QUEUE_MAILBOX.get(id);
      const internal = new URL(request.url);
      internal.pathname = match[2] ? `/v1/queue${match[2]}` : '/v1/queue';
      const internalRequest = new Request(internal.toString(), { method: request.method, headers: request.headers, body: request.body });
      return stub.fetch(internalRequest);
    }
    return json({ error: 'not found' }, 404);
  }
};
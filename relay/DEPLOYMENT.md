# Sovereign Relay Deployment Guide

Status: **Cloudflare relay DEPLOYED and production-verified; Node reference relay verified locally**

Sovereign Core supports two relay implementations using the same opaque queue contract:

- Cloudflare Worker + Durable Object SQLite
- Self-hosted Node + built-in SQLite

End users do not need accounts with either relay. Relay operators configure infrastructure; app users exchange signed invites and never provide vault keys or plaintext messages to the relay.

## Security boundary

Relays receive queue identifiers, capability hashes, ciphertext envelopes, timestamps, sizes, and delivery acknowledgements. They must not receive vault passwords, vault keys, plaintext messages, or private session keys.

Dual-relay mode improves availability, not anonymity. The client sends the same encrypted message ID to both relays, deduplicates on receipt, and acknowledges both copies independently.

## Node relay

Requirements: Node 24+.

```powershell
npm install
$env:PORT = 8787
$env:RELAY_HOST = '127.0.0.1'
$env:RELAY_DB = '.\relay.sqlite'
npm run relay:start
```

For public deployment, place the Node service behind an HTTPS reverse proxy or private tunnel. Do not expose plaintext HTTP to the public internet. Configure the app with the public HTTPS relay URL, not the local bind address.

Test the contract in this repository:

```powershell
node relay/node/test.mjs
node --test relay/integration.test.mjs
```

The repository test uses `127.0.0.2` because the local development host intercepts raw HTTP on `127.0.0.1`. Production Node defaults remain `127.0.0.1` unless the operator explicitly configures a bind address.

## Cloudflare Worker relay

Requirements: a Cloudflare account authenticated with Wrangler.

Validate without deploying:

```powershell
npm install
npm run relay:cf:dry
```

Authenticate interactively, then deploy from the repository root:

```powershell
wrangler login
wrangler deploy --config relay/cloudflare/wrangler.jsonc
```

The configuration provisions the `QUEUE_MAILBOX` Durable Object with SQLite storage. The Worker stores queue capabilities and opaque envelopes only. Review Cloudflare account, billing, retention, observability, domain, and abuse-control settings before production use.

The current environment is authenticated with Wrangler. The relay is deployed at:

- Production URL: `https://sovereign-relay.nrupalakolkar.workers.dev`
- Version: `201ac2b2-5797-4f32-98b7-513f09fd582f`
- Health: `GET /healthz` → 200 `{"ok":true}`
- Production E2E contract (provision → send → pull → ack → empty): PASS
- Local pentest (2026-09-19): `node scripts/pentest-relay-cf.mjs` → `Pentest(relay-cf): 24/24 defended` (CF-01..CF-24)

Rollback: `wrangler rollback --config relay/cloudflare/wrangler.jsonc` or delete the Worker.

## Application setup

The current Peer Chat UI provides:

1. Create identity and inbox.
2. Copy signed invite.
3. Paste and accept a contact invite.
4. Refresh inbox.
5. Send encrypted messages.

The relay URL is currently entered during profile setup. A later release should replace this with a clear deployment selector:

- production Cloudflare relay,
- local development relay,
- self-hosted Node relay.

## Verification and rollback

- Contract tests: `npm run relay:test`, `npm run test:relay-client`, `relay/integration.test.mjs`.
- Cloudflare local pentest: `node scripts/pentest-relay-cf.mjs` (24/24 defended).
- Production smoke: `relay/production-smoke.mjs`.
- Rollback: `wrangler rollback --config relay/cloudflare/wrangler.jsonc`.
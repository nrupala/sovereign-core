# Sovereign Relay Contract

Status: **Deployed and production-verified — Cloudflare Worker relay 24/24 pentest (2026-09-19)**

## Trust model

The relay is a delivery service, not an identity provider. It receives capability hashes, queue identifiers, opaque ciphertext envelopes, timestamps, sizes, and delivery operations. It does not receive vault keys, message plaintext, contact names, or ratchet private state.

## Queue model

Each relationship uses a random queue identifier and two independent random capabilities:

- send capability: may append envelopes,
- receive capability: may read and acknowledge envelopes.

Clients should hash capabilities before provisioning or using them as authorization values. The relay stores only a hash of the presented capability.

## Endpoints

- `POST /v1/queues` — create a queue with `queueId`, `sendCapability`, and `receiveCapability`.
- `POST /v1/queues/{queueId}/messages` — sender-only append of an opaque envelope.
- `GET /v1/queues/{queueId}/messages?limit=50` — receiver-only read of unexpired messages.
- `DELETE /v1/queues/{queueId}/messages/{messageId}` — receiver-only acknowledgement and deletion.
- `GET /healthz` — health only; no queue or message data.

## Envelope

The relay accepts an opaque JSON envelope with:

- `messageId`: deterministic client-generated ID for cross-relay deduplication,
- `ciphertext`: base64url ciphertext,
- `header`: ratchet/session header with no plaintext,
- `iv`: base64url AES-GCM IV,
- `createdAt`: client timestamp,
- optional `expiresAt` bounded by the relay TTL,
- optional authenticated signature verified by the client.

The relay must reject plaintext fields, oversize envelopes, expired messages, duplicate IDs, and malformed queue identifiers.

## Retention

- Maximum TTL: 7 days.
- Default TTL: 7 days.
- Expired records are removed on read, write, and scheduled cleanup.
- Successful receiver acknowledgement deletes the message immediately.
- If both relays are configured, the client sends the same `messageId` to both and deduplicates received envelopes locally.
- A relay outage does not authorize plaintext fallback.

## Redundancy

Primary and secondary relays are independent delivery targets. The client maintains per-relay state and sends the same ciphertext envelope to each available relay. The receiver polls both, merges by `messageId`, acknowledges each copy independently, and displays the message once.

This is availability redundancy, not a privacy guarantee: both relays can observe queue metadata and timing. Operators should use independent providers where that trade-off is acceptable.

## Deployment modes

- Cloudflare Worker + Durable Object SQLite storage.
- Node relay + built-in Node SQLite storage.
- Primary only, secondary only, or dual relay selected during setup.

Neither implementation is release-ready until contract tests, abuse controls, rate limits, authentication review, and deployment documentation pass.
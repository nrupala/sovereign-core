# Sovereign Core — Configuration Instructions

There is no bundled runtime config file for the browser app: configuration is mostly in `package.json` scripts, the relay server's command-line flags, the Cloudflare `wrangler.jsonc`, and the Capacitor wrapper for Android. This document lists each surface, what it does, and how to change it.

## 1. `package.json` scripts

| Script | Purpose |
|---|---|
| `npm run parse` | Parse all runtime ESM files with `node --check` |
| `npm run lint` | ESLint over the repo |
| `npm test` | Static + behavioral + Double Ratchet suite |
| `npm run test:crypto` | Password-verifier behavior (fail-closed) tests |
| `npm run test:scrubber` | Metadata scrubber unit tests |
| `npm run test:relay-client` | Relay client unit tests |
| `npm run docs:build` | Build HTML documentation site |
| `npm run docs:verify` | Verify docs site build and manifest |
| `npm run verify` | Full verification pipeline (G0/G1 evidence) |
| `npm run verify:browser` | Browser smoke, 19 checks, needs `:8765` + Chrome |
| `npm run verify:a11y` | axe accessibility audit (auth + Home) |
| `npm run relay:test` | Relay contract test |
| `npm run relay:start` | Start the local Node relay |
| `npm run relay:cf:dry` | `wrangler deploy --dry-run` for the Cloudflare relay |
| `npm run relay:cf:dev` | Local Cloudflare relay emulation on `:8788` |

## 2. Local HTTP server

`scripts/static-dev-server.mjs` serves the repo over HTTP on `127.0.0.1:8765`. Adjust the port by editing `listen(8765, '127.0.0.1', ...)` in that file. It sets `Cache-Control: no-store` and refuses paths outside the project root.

## 3. Reference relay (Node + SQLite)

File: `relay/node/server.mjs`, started with `npm run relay:start` or `node relay/node/server.mjs`.

- Default listen port: `8787`.
- Default persistence: `relay.sqlite` in the working directory.
- Health probe: `GET /healthz` returns `{"ok":true}` when running.
- Relay contract: `relay/RELAY_CONTRACT.md`; deployment details: `relay/DEPLOYMENT.md`.

Changes to port/database are command-line/env options of that server (see its `--help`/source) since this build keeps the reference server intentionally small.

## 4. Cloudflare relay

File: `relay/cloudflare/wrangler.jsonc` (also referenced by `npm run relay:cf:*`).

- Worker name, Durable Object bindings, limits, and compatibility flags live here.
- Deploy with `wrangler deploy --config relay/cloudflare/wrangler.jsonc`.
- The deployed Worker's URL is used as the relay `baseUrl` when peers create inbox queues.

## 5. Peer chat identity and relay configuration (in-app)

There is no file for this; it is configured inside the app UI:

- **Peer Chat → Create identity** creates the cryptographic profile.
- The profile's inbox is provisioned against a relay (the app currently prompts with a relay URL default `http://127.0.0.2:8902`; in production flows the production URL `https://sovereign-relay.<host>.workers.dev` is used).
- **Copy my invite** exports a signed invite containing your identity, public keys, and outbox capability.
- **Add via invite** accepts a contact by pasting their signed invite.

The producer/consumer of these flows is `core/peer.js` (functions `createPeerProfile`, `createInboxQueue`, `exportPeerInvite`, `acceptPeerContact`, `sendPeerText`, `pollPeerInbox`).

## 6. Environment variables used by scripts

| Variable | Used by | Meaning |
|---|---|---|
| `CDP_PORT` | device/CDP scripts (e.g. `phone-prod-sequenced.mjs`) | Chrome DevTools Protocol port, default `9222` |
| `BOB_IDENTITY` | `phone-prod-sequenced.mjs`, `run-e2e-full.mjs` | The peer identity that the phone-side E2E test must match |
| `RELAY` | `provision-phone-prod.mjs` | Relay base URL for phone provisioning |
| `INVITE_OUT` | `provision-phone-prod.mjs` | Where to write the exported invite |
| `EXPECT_FIRST` / `REPLY_TEXT` / `EXPECT_REPLY` | `phone-prod-sequenced.mjs` | Message-content expectations for the phone E2E driver |
| `SC_ROOT` | `scripts/static-dev-server.mjs` | Override the served root (default: project root) |
| `CHROME_PATH` | browser/a11y smokes | Override Chrome executable path |

## 7. Vault configuration (in-app)

- **Multiple vaults:** create/select/delete from the lock screen or sidebar.
- **Themes:** cycle 5 themes via the 🎨 button in the top bar.
- **Retention:** Settings tab controls local data retention.
- **Biometric login:** checkpointed as future work; not active.

## 8. Security-relevant defaults (do not weaken)

- PBKDF2-HMAC-SHA-256 with 600K iterations for password derivation.
- AES-256-GCM with a random IV per encryption, including per-message IVs in chat storage.
- Vault master key is non-extractable KeyMaterial; ratchet ephemeral keys are extractable only at creation and sealed at rest under the vault key.
- The chat database stores only ciphertext plus minimal envelope metadata; conversation previews are `[encrypted]`.
- Wrong passwords fail closed (no legacy/assume-correct unlock).

Changing the iteration count, removing the challenge verifier, or storing plaintext message bodies is a security regression and contradicts the release plan.
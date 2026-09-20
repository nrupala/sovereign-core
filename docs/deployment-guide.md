# Sovereign Core — Deployment Guide

This document covers how to deploy the pieces needed for a working peer-chat deployment: the browser app, the reference relay (Node), and the production relay (Cloudflare Workers). It also records the verified desktop↔phone E2E scenario and the hardware prerequisites, and it states the release boundary honestly.

## 1. Deployment model

```
                        ┌──────────────┐
   Desktop browser ───▶ │  Relay       │ ◀─── phone WebView / PWA
   (Peer A)  ──────────▶│ (queue)      │────────▶ (Peer B)
                        └──────────────┘
```

- Peers exchange signed invites out-of-band.
- Each peer provisions a private inbox on the relay.
- Messages travel as opaque AES-256-GCM envelopes through the relay (ciphertext + envelope header only); the relay never sees plaintext.
- Local message history is stored encrypted in the device's own chat database.

## 2. Deploy the relay

### 2a. Local reference relay (dev/CI, no auth)

```pwsh
node relay/node/server.mjs        # port default 8787, SQLite persistence
```

Health: `GET http://127.0.0.1:8787/healthz` → `{"ok":true}`.
Contract tests: `npm run relay:test`, `npm run test:relay-client`, plus `relay/integration.test.mjs`.

### 2b. Production relay (Cloudflare Workers + Durable Object)

Prereq: authenticated `wrangler`.

```pwsh
npm run relay:cf:dry
wrangler deploy --config relay/cloudflare/wrangler.jsonc
```

After deployment the Worker is reachable at `https://sovereign-relay.<your-subdomain>.workers.dev` (verified against the `sovereign-relay.nrupalakolkar.workers.dev` deployment on 2026-09-10, version `201ac2b2`).

Configure peers' inboxes to point at this base URL. The relay contract (queue IDs, capability secrets, TTL, acknowledgements, redundancy) is documented in `relay/RELAY_CONTRACT.md`; operator setup in `relay/DEPLOYMENT.md`.

## 3. Deploy the app

### 3a. Browser / PWA

Serve the repo root over HTTPS (or `localhost`). The PWA foundation (`manifest.json`, `sw.js`, 192/512 icons) is present; standalone-install verification on macOS/iOS Safari remains an open gate.

Local dev server already included:

```pwsh
node scripts/static-dev-server.mjs   # http://127.0.0.1:8765/
```

### 3b. Android (debug APK)

```pwsh
node scripts/configure-capacitor-android.js .apk-wrapper/android
# then build with the Android Gradle toolchain and install via adb
```

The Android debug build is the artifact used for physical-device E2E. Release signing/provenance is not yet configured (G6).

## 4. Verified end-to-end scenario (desktop ↔ physical phone)

This exact path passed on 2026-09-10 against the production Cloudflare relay and a physical Samsung SM-S938W:

| Step | Tool | Evidence marker |
|---|---|---|
| Provision phone profile + inbox on production relay | `scripts/provision-phone-prod.mjs` | `INVITE_WRITTEN ...` |
| Desktop Bob accepts phone invite, clears sessions, sends first message | `scripts/live-peer.mjs ... --accept data/phone-invite-prod.json --clear-sessions --send Phone hello-from-bob --watch Phone 120` | `SENT ...` |
| Phone driver polls, decrypts first message, replies through the real composer | `scripts/phone-prod-sequenced.mjs` | `"ok": true, "firstHit": ..., "sentReply": true` |
| Desktop receives phone reply | `live-peer.mjs` watch loop | `RECEIVED ... incoming=true` + `WATCH_PASS` |

Identities: phone side `rel_d8b4f0...` (dev loopback history), production desktop Bob `rel_f5f9cf9b56dd429e97b485244b510a87` (the current production target identity in all phone E2E drivers).

## 5. Platform gates still open

- **iOS PWA**: standalone launch, safe-area layout, install verification — not yet run.
- **Android release**: signed artifact, marketplace/enterprise distribution, provenance — not yet configured.
- **Documentation site build (G9)**: Apple Developer-standard HTML build script not yet implemented; CI verification pending.

Verified and closed:
- **Desktop↔phone E2E duplex** over the production Cloudflare relay (2026-09-10, re-verified 2026-09-17 — `run-e2e-full.mjs` exit 0).
- **Cloudflare Worker local pentest** — `node scripts/pentest-relay-cf.mjs` 24/24 defended (2026-09-19).
- **Relay contract/integration tests** — PASS.
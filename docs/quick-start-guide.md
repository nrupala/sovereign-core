# Sovereign Core — Quick Start Guide

Get from zero to a working, verified install in under five minutes.

## 1. Requirements

- Node.js 20+ (Node 24 used in CI) and npm.
- Chrome (or a Chromium-family browser) for the interactive and browser-verification paths.
- Project directory: `D:\research\sovereign-core` (this repo).

## 2. Install dependencies

```pwsh
cd D:\research\sovereign-core
npm install
```

## 3. Serve the app locally

```pwsh
node scripts/static-dev-server.mjs
```

Opens `http://127.0.0.1:8765/`. Leave this running in another terminal.

## 4. Open and use the app

- Open `http://127.0.0.1:8765/` in Chrome.
- On the lock screen choose **Create**, name a vault, set a master password, and unlock.
- Explore **Tasks**, **Notes**, **Habits**, **Ledger**, **Journal**, **Calendar**, **Analytics**, **Companion**, and **Peer Chat**.
- Lock and unlock again to confirm your records persist.

## 5. Verify the install in one command

```pwsh
npm run verify
```

Expected tail: parser 36 files, ESLint clean, 73/73 suite, crypto 6/6, scrubber 2/2, relay-client 4/4, identity 5/5, chat-session 4/4, contact-meta 10/10, analytics 9/9, security 9/9, zeroization 5/5, peer 7/7, peer-reset 2/2, SESSION_RESUME_PASS, relay contract/integration PASS, Capacitor config OK — final line `Verification passed.`

Additional gates:

```pwsh
npm run verify:browser   # 19/19 smoke checks (needs the :8765 server + Chrome)
npm run verify:a11y      # 0 axe violations (auth + Home)
npm run lint             # ESLint clean
```

## 6. First chat message (two peers)

For a scripted peer test without a phone:

```pwsh
# Terminal A — run the reference relay (loopback)
node relay/node/server.mjs

# Terminal B — Bob sends to Phone contact
node scripts/live-peer.mjs http://127.0.0.1:8787 <password> Bob --invite-out data/bob-invite.json --watch Phone 120
```

Then accept the invite on the other side and send from the Chat tab. For the full automated desktop↔phone duplex against the production relay, see `docs/deployment-guide.md` and `docs/troubleshooting-faq.md`.

## 7. What not to expect yet

This is an enterprise-readiness build, not a release. No HIPAA/regulatory/compliance claim is made by the current build. Peer chat is functional and E2E-tested on device, but release hardening (offline queue edge cases, iOS PWA, marketplace distribution, dependency provenance) remains open per `ASFQC/GATES.md`.
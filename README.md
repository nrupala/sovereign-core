# Sovereign Core v2.0

**Status: ENTERPRISE-READINESS REVIEW — NOT RELEASE READY**

Sovereign Core is a buildless, local-first encrypted workspace for tasks, notes, habits, ledger, journal, calendar, analytics, Companion, and **verified peer-to-peer encrypted chat** (identity, invite exchange, relay transport, Double Ratchet sessions, session persistence — desktop↔phone E2E verified 2026-09-10, re-verified 2026-09-17; Cloudflare Worker relay pentest 24/24 local 2026-09-19).

The current repository is under a truth-reconciliation and quality refactor. Phase 0 syntax repair and Phase 1 quality foundation are complete (73/73 suite, analytics 9/9, contact-meta 10/10, zeroization 5/5, peer 7/7, peer-reset 2/2). Phase 2+ roadmap items are in progress. Do not treat the current APK, historical claims, or test count as enterprise or production evidence.

## Current runtime

- `index.html` is the single browser entry point.
- `ui/SovereignApp.js` contains the currently shipped application shell and inline styles.
- `core/crypto.js` provides PBKDF2-HMAC-SHA-256 key derivation, AES-GCM encryption, and challenge verification.
- `core/db.js` provides OPFS/IndexedDB storage and vessel persistence.
- `core/chat-db.js` provides isolated local chat storage.
- `core/double-ratchet.js`, `core/broker.js`, and `core/sync.js` contain transport/ratchet building blocks. Desktop↔phone E2E chat is verified (2026-09-10, re-verified 2026-09-17) and the Cloudflare Worker relay pentest passes 24/24 (2026-09-19).
- `sw.js` provides offline caching; PWA and Android packaging require separate platform verification.

## Important current limitations

- `ui/SovereignApp.js` passes `node --check` and the full parser/import pipeline. The app boots in Chrome and passes the browser smoke and axe accessibility gates.
- The current Chat tab provides **verified peer-to-peer E2EE** (persistent identity, signed invites, fingerprint verification, ciphertext-only relay transport, per-contact Double Ratchet sessions, session persistence across restarts). Desktop↔phone E2E was verified on 2026-09-10 and re-verified on 2026-09-17 against the production Cloudflare relay. The Cloudflare Worker local pentest now passes 24/24 (2026-09-19).
- Contact public keys, relay configuration, incoming messages, identity exchange, ratchet-session persistence, offline delivery, and cross-device transport are verified end to end in the desktop↔phone E2E suite (2026-09-17, production relay).
- The current test suite contains static checks and behavioral tests (73/73 suite, crypto 6/6, scrubber 2/2, relay-client 4/4, identity 5/5, chat-session 4/4, contact-meta 10/10, analytics 9/9, security 9/9, zeroization 5/5, peer 7/7, peer-reset 2/2) plus browser smoke (19/19) and axe accessibility (0 violations).
- Several documentation files previously described planned or library-level capabilities as shipped capabilities. Those claims are being reconciled.

## Product direction

The target product is a private personal operating space:

- Capture: Tasks, Notes, Journal, Voice
- Track: Habits, Ledger, Calendar, Analytics
- Communicate: verified contact-based encrypted chat
- Understand: search, summaries, Companion, reminders
- Control: onboarding, backup, privacy, help, identity, settings

The app must be understandable to ordinary users while exposing precise operational information to security, AI, safety-critical, healthcare, and corporate operators.

## Documentation and roadmap

- `BUILD_PLAN.md` — approved roadmap proposal, phases, exit gates, and rollback paths
- `DEVELOPMENT_PROGRESS_TRACKER.md` — append-only implementation evidence
- `USER_GUIDE.md` — user-facing guide with current-state limitations
- `WALKTHROUGH.md` — code/runtime walkthrough and claim boundaries
- `COMMUNICATION_v2.md` — communication architecture status and future contract
- `HOLLOW_VESSEL_ARCH.md` — storage/encryption architecture and known metadata boundary
- `METADATA_SOVEREIGNTY.md` — implemented versus planned metadata controls
- `ASFQC/GATES.md` — ASF quality gate evidence
- `CONTRIBUTING.md` and `CODE_OF_CONDUCT.md` — project participation controls
- `CHANGELOG.md` — release and planning history
- `docs/PROTOTYPE_UI.md` — onboarding/Home/Peer Chat visual prototype
- `docs/CHAT_PROTOCOL.md` — peer-chat identity, invite, relay, session, and delivery contract
- `docs/CHAT_TECHNOLOGY_RESEARCH.md` — SimpleX/XMPP comparison and transport decision input
- `relay/RELAY_CONTRACT.md` — dual-relay queue contract, TTL, acknowledgement, and redundancy
- `relay/DEPLOYMENT.md` — Node/Cloudflare deployment and operator setup
- `relay/node/server.mjs` — Node + SQLite reference relay (not yet production-verified)
- `relay/cloudflare/` — Cloudflare Worker + Durable Object reference relay (**deployed and production-verified 2026-09-10; local pentest 24/24 2026-09-19**)

## Verification policy

Before production or enterprise testing, the project must pass parser/import checks, behavioral tests, browser tests, mobile/PWA tests, chat interoperability tests, accessibility checks, build reproducibility checks, and all applicable ASF gates. See `BUILD_PLAN.md`.

## Local verification

```
npm install
npm run verify
npm run verify:browser
npm run verify:a11y
```

`npm run verify` runs parser checks, ESLint, 73 test-suite checks, crypto behavior, scrubber tests, and CI consistency checks. `npm run verify:browser` requires Chrome and a static server at `127.0.0.1:8765`; it covers boot, vault create/lock/unlock, wrong-password rejection, navigation, contact create/delete, and page errors. `npm run verify:a11y` runs axe checks against the authentication and Home/Today control trees. Android, iOS PWA, responsive/manual accessibility, clean-checkout CI, and peer Chat interoperability remain separate release gates.
# Sovereign Core v2.1.0

**Status: v2.1.0 — billing live (one-time licence, issuer + in-app activation). Storage rework (Phase 1) in progress; not yet published on Google Play.**

Sovereign Core is a buildless, local-first encrypted workspace for tasks, notes, habits, ledger, journal, calendar, analytics, and a local Companion. It is a journal-first personal workspace: no account, no cloud, no sync, no telemetry — everything is stored on your device, encrypted under your vault password.

Test reality (verified 2026-10-19): the test suite passes 69/69 (`node test-suite.js`) and the Node unit tests pass 46/46 (`npm run test:unit`, covering the core and billing suites). Earlier documents in this repository cited a "73/73" suite and September 2026 verification events (desktop↔phone E2E, relay pentest 24/24, closed quality gates); those figures do not reproduce from the code in this repository and are superseded — see the 2026-10-12 correction entry in `CHANGELOG.md`. Do not treat historical claims or historical test counts as production evidence. The APK wrapper in this repository predates this release and is not the distribution artifact; Google Play packaging is a later phase.

## Current runtime

- `index.html` is the single browser entry point.
- `ui/SovereignApp.js` contains the currently shipped application shell and inline styles.
- `core/crypto.js` provides PBKDF2-HMAC-SHA-256 key derivation, AES-GCM encryption, and challenge verification.
- `core/db.js` provides OPFS/IndexedDB storage and vessel persistence.
- `core/chat-db.js` provides isolated local chat storage. Chat data never leaves the device; no transport is wired to it in the shipped app.
- `core/double-ratchet.js`, `core/broker.js`, and `core/sync.js` contain transport/ratchet building blocks. These are research code, not a shipped feature: nothing in the application sends messages anywhere, and no relay client is wired into the shipped app. Peer messaging is not part of the product (owner decision, 2026-10-12); the code is preserved as labelled R&D.
- `sw.js` provides offline caching; PWA and Android packaging require separate platform verification.

**Family note:** The vault family's storage standard is SQLite + SQLCipher. Sovereign Core currently stores via OPFS/IndexedDB with WebCrypto AES-GCM; aligning its storage — SQLite with envelope keys, a recovery key, and encrypted backup — is Phase 1 of its active build, in scope now per the owner's direction.

## Important current limitations

- `ui/SovereignApp.js` passes `node --check` and the test suites below. No browser-smoke or accessibility harness ships in this repository, and no accessibility pass has been verified.
- The current Chat tab is local-only: messages are encrypted with the vault key and stored on this device. It does not contact any peer or relay — there is no relay client in the shipped app, the attachment button is not wired, and contacts do not exchange keys with anyone. Peer-to-peer messaging is not a product feature (see Product direction).
- A larger September 2026 peer build (identity, invites, relay client, sessions) exists only as a recovered snapshot on branch `laptop/september-build-20261012` under `recovered/september-www/`, preserved as R&D. Its own recorded gate claims do not reproduce from that snapshot (its unit suite is 54 tests with 7 failures, and its relay end-to-end tests fail as run); see `recovered/september-www/RECOVERY_NOTE.md`.
- The current test reality (2026-10-12): `node test-suite.js` passes 69/69 and `node --test core/*.test.js` passes 17/17 (analytics 9/9, crypto 6/6 — including the fail-closed password-verifier regression suite added with the 2026-10-12 verifier fix — scrubber 2/2).
- Several documentation files previously described planned or library-level capabilities as shipped capabilities. Those claims are being reconciled.

## Product direction

The target product is a private personal operating space:

- Capture: Tasks, Notes, Journal, Voice
- Track: Habits, Ledger, Calendar, Analytics
- Communicate: nothing — the product is deliberately single-device. Peer communication is out of scope; the comms code in this repository is preserved as R&D only.
- Understand: search, summaries, Companion, reminders
- Control: onboarding, backup, privacy, help, identity, settings

The app must be understandable to ordinary users. It makes no compliance claims (HIPAA or otherwise) and is not positioned for regulated or safety-critical use.

## Licence & billing

Sovereign Core is a commercial product of 2351485 ALBERTA INC., sold as a one-time US$49.99 licence — no subscription. Buy through the official payment link: https://buy.stripe.com/5kQ3cvc0GbEI4qH32C9Zm05. After checkout, the claim page shows your licence key; activate it in the app under **Settings → Licence**. Activation is verified offline on your device — the app makes no server call to check a licence. In the shipped configuration (`activation-required`), a licence is needed to create a new vault; it never gates opening or exporting a vault you already have.

The issuer service — Stripe webhook issuance, claim page, refund revocation, and the revocation blocklist — lives in `billing/` and runs at sovereign-billing.aimlds.org. Code licensing is a proprietary core with an Apache 2.0 interface layer: see `LICENSING.md`. The terms that govern the product are in `TERMS.md`; direct purchases carry the 30-day money-back guarantee stated there.

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
- `relay/RELAY_CONTRACT.md` — dual-relay queue contract, TTL, acknowledgement, and redundancy (research design; not used by the shipped app)
- `relay/DEPLOYMENT.md` — Node/Cloudflare deployment and operator setup (research design)
- `relay/cloudflare/` — Cloudflare Worker + Durable Object reference relay (library code with no client in the shipped app; historical deployment and pentest claims are unverified — see the 2026-10-12 correction in `CHANGELOG.md`)

## Verification policy

Before production or enterprise testing, the project must pass parser/import checks, behavioral tests, browser tests, mobile/PWA tests, accessibility checks, build reproducibility checks, and all applicable ASF gates. See `BUILD_PLAN.md`.

## Local verification

```
npm install
npm test           # node test-suite.js — 69/69
npm run test:unit  # node --test core/*.test.js — 17/17
npm run lint
npm run verify     # lint + test + docs build/verify
```

These are the verification commands that exist in `package.json` today. Older revisions of this document referenced `verify:browser`, `verify:a11y`, and `verify:pentest` scripts and the results they supposedly produced; those scripts are not in this repository and the results are unverified. Android, iOS PWA, responsive/manual accessibility, and clean-checkout CI remain separate release gates.
# Changelog

## Unreleased

- **Commercial terms.** Sovereign Core licences purchased directly from the Company now carry a 30-day money-back guarantee under `TERMS.md` (owner decision, 2026-10-19). A refund ends the licence and revokes its key; existing vaults and data remain unaffected.
- **Transaction pages.** Sovereign Core’s buying surfaces now follow the fleet transaction-page standard (owner’s rule, 2026-10-21; imported from LetsAskIt’s shipped implementation): a new pricing page carrying the offer and a “Buying, in plain terms” section (seller of record, what the one-time licence attaches to, the 30-day money-back guarantee, privacy and release-log links), a new privacy page, and the standard seller strip on the pricing and privacy pages and in the app’s two licence areas. The issuer’s claim pages receive the same strip in a separate change, deployed through the release process. Testing: local suites on the branch content — test-suite 69/69, unit tests 59/59, eslint 0 errors, docs build and verify pass; a served-tree check asserted every seller-strip link resolves and that the price, payment link, guarantee wording, and support address match the live objects and `TERMS.md` §9 (21/21 checks). Live proof (2026-10-21): the served pricing and privacy pages return 200 carrying the seller strip and the plain-terms section, and the served app script carries the strip in both licence areas.

## [2.1.0] — 2026-10-19

- **Security — billing gate fixes.** The billing issuer no longer trusts the Stripe test-mode webhook secret anywhere in its code (the production deployment verifies against its own live secret only; test-mode proofs run against a separate test deployment), issuance is bound to the Sovereign Core payment link, amount, and currency with live-mode and paid status required (sessions for other products on the shared account, and unpaid sessions, mint nothing), a later async payment failure now claws back any licence already issued for that session, refund revocation applies to full refunds only, and the in-app Buy links point at the live payment link (they previously carried a link that does not exist in the account). (Release-gate findings F-SC-1, F-SC-2, F-SC-3, F-SC-4, F-SC-7.)

- **Security — claim-layer payment-failure guard.** The buyer claim page now refuses to display a licence key for any checkout session with a recorded payment failure, even if the licence record still reads "active" because the async claw-back's revocation write has not yet propagated through KV (eventual consistency), and the async-payment-failure webhook now also revokes through the payment-intent index as a second idempotent path.

- **Billing (new).** Sovereign Core is sold as a one-time US$49.99 licence (Stripe). The issuer service (`billing/`, live at sovereign-billing.aimlds.org) issues a signed licence key from the checkout webhook, serves the buyer claim page, and revokes keys on refund; revoked key ids are published on its blocklist endpoint. The in-app licence module (`core/license.js`) verifies keys offline on the device — there is no server check — and gates vault creation only: opening or exporting an existing vault is never gated, in either licence mode. Entitlement was verified end-to-end on 2026-10-19 (grant → claim → activation → refund → revocation). The licence mode is a configuration switch (`UNPAID_MODE` in `core/license.js`); the shipped setting is `activation-required`. (PRs #10, #11, #13.)
- **Licensing.** The repository carries the split licence decided for the product: proprietary core with an Apache 2.0 interface layer, patent rights expressly reserved on the core. See `LICENSING.md`, `LICENSES/`, and the product terms in `TERMS.md`. (PR #4.)
- **Fixed — password verification.** `verifyPassword()` accepted every password: any input, including an empty one, unlocked a vault, and vault deletion used the same verifier. It now fails closed — a password is accepted only when the stored verifier decrypts under the key derived from it. Regression suite in `core/crypto.test.js`. (PR #5.)
- **Fixed — CI install failure.** A dependency bump (PR #6) moved wrangler to a version whose peer range requires `@cloudflare/workers-types` ^5 while the project pinned ^4, so `npm ci` failed and main's CI was red at the install step. Types aligned to ^5; lockfile regenerated. (PR #12.)
- **Documentation.** The 2026-10-12 correction entry below stands: repository documentation was scrubbed to verified reality — shipped-chat claims, "73/73", device-E2E, and gate-closure claims removed or marked superseded. (PR #7.)

## Correction — 2026-10-12 (claim reconciliation; documentation only)

A full audit of this repository against its code (2026-10-12), plus a verification pass over the recovered September 2026 laptop build, establish the following corrections to the entries below. The historical entries are left unchanged; this entry supersedes them wherever they conflict.

- **Test counts.** The suite figure for this repository is 69/69 (`node test-suite.js`) with Node unit tests at 17/17 (`node --test core/*.test.js`) — not "73/73". The 73 figure described a larger test set from the September research build and does not reproduce: that build's own unit suite is 54 tests with 7 failures.
- **Peer chat.** The shipped application in this repository never sent messages anywhere: the Chat tab is local encrypted storage with no relay client wired in. Entries below that describe desktop↔phone E2E verification, production-relay duplex, session-resume passes, and relay contract/integration passes as properties of this product are **unverified and superseded**. A larger September peer build exists (recovered to branch `laptop/september-build-20261012` under `recovered/september-www/`); its end-to-end relay tests fail as run in the verification environment, and its recorded gate claims do not reproduce.
- **Pentest claims.** The pentest entries below cite harnesses (`scripts/pentest-relay.mjs`, `scripts/pentest-xss.mjs`, `scripts/pentest-storage.mjs`, `scripts/pentest-relay-cf.mjs`) and results (28/28, 9/9, 8/8, 24/24) that are not present in, and cannot be reproduced from, this repository or the recovered build. No pentest scripts or accessibility harness were found in either tree. Treat those entries as unverified.
- **Gates.** The `ASFQC/GATES.md` statuses (including "Phase 8 gates CLOSED") are superseded by the correction header added to that file on this date.
- **Product decision.** Peer-to-peer chat is dropped from the sellable product (owner decision, 2026-10-12). The comms code is preserved as labelled R&D. Sovereign Core is a journal-first, local-first encrypted personal workspace: no account, no cloud, no sync, no telemetry.
- **Verifier fix (already on main).** The same audit proved that `verifyPassword()` accepted every password; that defect was fixed on main before this correction was written (fail-closed verifier; regression suite in `core/crypto.test.js`). Notably, the recovered September build already contained the fail-closed behaviour — the defect was a regression introduced when the GitHub line was later reconciled over that state.

## Unreleased — 2026-09-19 Cloudflare Worker pentest lane + relay CF-17 fix + analytics fix

- **Cloudflare Worker local pentest lane DONE (G11.3 extension):** `node scripts/pentest-relay-cf.mjs` returns `Pentest(relay-cf): 24/24 defended` (CF-01 health 200, CF-02 queue registration 201, CF-03 no secret echo, CF-04–CF-07 unauthenticated/rejected 403, CF-08 wrong capability 403, CF-09–CF-13 invalid queue id 400, CF-14 malformed JSON 400, CF-15 non-string ciphertext 400, CF-16 expired envelope 400, CF-17 valid send 202, CF-18 oversized body 413, CF-19 SQL injection inert, CF-20 delete with receive capability 200, CF-21 delete path traversal handled, CF-22 no path leak, CF-23 CORS *, CF-24 unknown route 404).
- **CF-17 403 regression fixed (`relay/cloudflare/src/index.js`):** in `wrangler dev --local` different queue IDs can collide into the same Durable Object instance; the queue table accumulated rows from multiple registrations, and `authorized()` used `SELECT ... WHERE send_hash = ?` against the presented hash — a stale row from a previous registration caused a valid capability to be rejected. Fix: `DELETE FROM queue` before `INSERT` on registration, and `authorized()` reads the single remaining row directly.
- **Analytics test fix:** `core/analytics.test.js` tests called `analyzeHabits()` without the optional `asOf` parameter added during the engine refactor; updated tests to pass `asOf` explicitly. `core/analytics.test.js` now 9/9 passing.
- **Full verification (observed):** `npm run verify` — parser 36 files, 73/73 suite, crypto 6/6, scrubber 2/2, relay-client 4/4, identity 5/5, chat-session 4/4, contact-meta 10/10, analytics 9/9, security 9/9, zeroization 5/5, peer 7/7, peer-reset 2/2, SESSION_RESUME_PASS, relay contract/integration PASS; `npm run lint` clean; `npm run verify:browser` 19/19; `npm run verify:a11y` 0 violations (auth/home/contacts/analytics); `node scripts/pentest-relay-cf.mjs` 24/24.
- **Gates:** `ASFQC/GATES.md` — all Phase 8 gates PASS (G9, G10, G11, including G11.3 Worker pentest lane 24/24); device-present phone E2E re-run DONE (PASS); Android release signing, iOS PWA standalone verification, marketplace distribution, dependency provenance, and docs-site build (G9) remain open.

## Unreleased — 2026-09-17 G11.3 penetration test (Phase 8 gates closed)

- **Internal pentest executed (`docs/PENTEST_REPORT.md`):** three adversarial harnesses, all self-provisioning and chained as `npm run verify:pentest`. Relay **28/28** defended + 3 accepted risks; client injection **9/9** (pre-fix 4/9); record storage **8/8** (pre-fix 4/7).
- **F-01 (High) stored XSS via attribute injection — FIXED:** `_esc()` used a DOM serializer, which escapes `<`, `>`, `&` but **not** `"`/`'`. A hostile peer `displayName` (stored as a contact name) could break out of `aria-label`/`title`/`value` in 9 sinks and execute script in the vault origin (pre-fix X-05 `pwn=1`). Rewritten as an explicit char-map escaping `& < > " '` (`ui/SovereignApp.js:78`), context-agnostic so no call site can regress.
- **F-02 (High) path traversal outside the record store root — FIXED:** peer-controlled `invite.identityId` (`peer_<identityId>`) and relay `envelope.messageId` reached storage unvalidated. Fixed at the boundary: `assertRecordId()` in `core/chat-db.js` (`putRecord`/`getRecord`/`deleteRecord`), `IDENTITY_ID_RE` in `core/chat-identity.js:9` (`verifyInvite`), and `PEER_ID_RE`/`SAFE_MESSAGE_ID_RE`/`safeMessageId()` in `core/peer.js` (`pollPeerInbox` skips malformed senders and stores under a sanitised id while still acking the original relay id).
- **Accepted risks (documented, not fixed):** R-27 queue-id first-write-wins squatting (Low, infeasible to guess), R-28 no queue-creation rate limit (Medium, infrastructure-tier), R-29 CORS `*` (Low, capability auth still required). Recorded in `docs/PENTEST_REPORT.md` §5.
- **Explicit gaps stated:** the production Cloudflare Worker relay and the Android WebView are **not** covered by this engagement; both are tracked as standing release items in `ASFQC/GATES.md`.
- **New harnesses/scripts:** `scripts/pentest-relay.mjs` (R-01..R-31), `scripts/pentest-xss.mjs` (X-01..X-09), `scripts/pentest-storage.mjs` (S-01..S-08); `package.json` `verify:pentest` (+ `:relay`/`:storage`/`:xss`).
- **Gates:** `ASFQC/GATES.md` — G11.3 PASS, **G11 PASS, Phase 8 (G9 + G10 + G11) gates CLOSED**. Release readiness still gated by standing caveats (Worker pentest lane, device-present phone E2E re-run, documentation site G9).
- **Verification (observed):** `npm run verify:pentest` = relay 28/28 + 3 risks, storage 8/8, xss 9/9 (exit 0); `npm run verify` PASS (no regression); `npm run lint` clean; `npm run verify:browser` 19/19; `npm run verify:a11y` 0 violations (auth/home/contacts/analytics).

## Unreleased — 2026-09-17 Phase 8 analytics, security gates, threat model

- **Refined analytics engine (`core/analytics.js`):** pure, local-only, zero-dependency. Day/week bucketing, `normalizeCheckin` (accepts ISO and `Date#toDateString`), task totals/overdue/week-over-week trend, 13-week habit heatmap with streak, needs/wants spending split, by-hour/by-day-of-week productivity, `buildReport`, and `exportCSV`/`exportJSON`. No network calls, no storage access.
- **Analytics UI (`ui/SovereignApp.js`):** engine-backed analytics module with priority list, needs-vs-wants, insights, a weekly bar chart, a habit heatmap, and CSV/JSON export buttons (local Blob download).
- **Security & leak-prevention suite (`core/security.test.js`, 9/9):** proves PII is never stored in plaintext, wrong vault keys fail closed, message bodies are ciphertext at rest, the relay envelope rejects malformed input and carries no PII fields, the metadata schema rejects sensitive identifiers (ssn/passport/password/card/tax/medical), list snippets mask phone/email, and the local Companion resists prompt-injection without side effects.
- **Contact-merge audit trail (`core/chat-db.js`):** new append-only `contact_merge_log` store and `getContactMergeLog()`; `mergeContacts` now records survivor/discarded ids, migrated-conversation count, merged field names, and a timestamp — never PII values.
- **Memory-zeroization suite (`core/zeroization.test.js`, 5/5) + boundary doc (`docs/MEMORY_ZEROIZATION.md`):** proves the vault key is non-extractable (raw/JWK export rejected), least-privilege (`AES-GCM`-256, `encrypt`/`decrypt` only), wrong passwords fail closed, the password byte buffer is zeroized in a `finally`, and `lock()` releases the key reference; documents the explicitly not-guaranteed properties (N1-N5) rather than overclaiming.
- **Dead-code defect fixed (`core/identity.js`):** imported a non-existent `deriveSovereignKey` from `core/crypto.js` (unused at runtime — the app calls `deriveKey` directly); corrected to `deriveKey` and now covered by the zeroization suite.
- **Threat model (`docs/THREAT_MODEL.md`):** assets, trust boundaries, 12 threats mapped to controls with verification, and residual risks R1-R5.
- **Architecture diagrams (`docs/ARCHITECTURE_DIAGRAMS.md`):** 5 Mermaid diagrams (system, encrypted data flow, key lifecycle, user journey, analytics flow), each verified to parse and render.
- **Docs:** `docs/user-guide.md` updated for analytics export + heatmap, a Contacts section (metadata, masking, merge), and diagrams/threat-model links.
- **Accessibility gate extended (`scripts/accessibility-smoke.mjs`):** now axe-audits the Contacts and Analytics tabs alongside Auth and Home.
- **Gates:** `ASFQC/GATES.md` — G9 PASS (G9.1-G9.4), G10 PASS, G11.1 + G11.2 PASS; G11.3 (pentest) is the only remaining Phase 8 gate.
- **Verification (observed):** `npm run lint` clean; `npm run verify` PASS (parser 36, 73/73 core, crypto 6/6, scrubber 2/2, relay-client 4/4, identity 4/4, chat-session 4/4, contact-meta 10/10, analytics 9/9, security 9/9, zeroization 5/5, peer 5/5, SESSION_RESUME_PASS, relay contract/integration PASS); `npm run verify:a11y` 0 violations (auth/home/contacts/analytics); `npm run verify:browser` 19/19.

## Unreleased — 2026-09-12 device E2E re-verified + integrity fixes

- **Live device E2E duplex re-verified** (Samsung SM-S938W ↔ desktop Bob over the production Cloudflare relay): Bob→Phone `e2e-final4-0912` decrypted and stored; Phone→Bob `e2e-final4-reply-0912` received and decrypted (`WATCH_PASS`).
- **Message-loss fix (`core/chat-db.js`, `core/peer.js`):** a transient OPFS/nodefs read failure used to silently skip contact records, making `pollPeerInbox` treat a known sender as unknown and ack-and-drop real mail at the relay. Reads now retry once; inbox routing uses a new deterministic direct lookup (`getContact('peer_<identityId>')`); lookup errors leave mail queued instead of acking; the app wrapper `_peerPollInbox` uses the same direct lookup (it previously re-looked-up via scan after the envelope was already acked).
- **Windows nodefs keyring fix (`core/chat-db.js`):** keyring ids contain `:` which created NTFS alternate data streams instead of files — records were invisible to listing, so `clearPeerSessions()` deleted nothing on desktop and stale mid-chain sessions broke fresh handshakes (`OperationError` on the pristine peer). Filenames are now sanitized (`:` → `+`); the record id inside the JSON is authoritative. Regression tests added (peer suite now 5/5).
- **Service-worker stale-module operational fix:** SW cache survives `adb install -r` and pinned old modules at boot; `scripts/fix-phone-sw.mjs` unregisters/clears/reloads after every APK update. SW cache-version bump on asset changes is now a tracked release item (G6).
- **Chat UI fix (`ui/SovereignApp.js`):** conversations rendered newest-first while scrolling to the bottom, hiding the newest messages; now oldest→newest with the newest above the pinned composer (verified on device).
- **Device tooling:** `scripts/static-dev-server.mjs` (browser/a11y gate server), CDP phone helpers (`unlock-phone-cdp`, `navigate-phone-tab`, `open-phone-chat`, `probe-phone-db`, `probe-phone-queue-raw`, `probe-phone-sessions`, `probe-phone-inbox-id`, `probe-phone-sw`, `fix-phone-sw`, `probe-phone-poll`, `test-opfs-write`, `valid-exchange-test`, `wrapper-save-test`, `cleanup-phone-test-contacts`).
- **Verification (observed):** `npm run verify` PASS (parser 36, eslint, 73/73, crypto 6/6, scrubber 2/2, relay-client 4/4, identity 4/4, chat-session 4/4, peer 5/5, SESSION_RESUME_PASS, relay contract/integration PASS); `npm run lint` PASS; `verify:browser` 17/17; `verify:a11y` 0 violations; APK rebuilt and installed with vault data preserved.

## Unreleased — 2026-09-12 verification re-run

- `scripts/phone-accept-bob.mjs`: fixed `acceptPeerContact` handling — the function returns a contactId string, not a contact object; the script now reloads the saved contact via `getAllContacts()` to report `contactId`/`identityId` correctly.
- `scripts/static-dev-server.mjs`: added a small no-store static dev server (path-traversal guarded) used to serve `:8765` for the browser and accessibility gates; survives PowerShell quoting/detach issues that broke ad-hoc `node -e` servers.
- Verification re-run (observed): `npm run verify` PASS (parser 36 files, eslint, 73/73 suite, crypto 6/6, scrubber 2/2, relay-client 4/4, identity 4/4, chat-session 4/4, peer 2/2, SESSION_RESUME_PASS, relay contract/integration PASS); `npm run lint` PASS; `npm run verify:browser` 17/17; `npm run verify:a11y` 0 violations. Live phone-leg E2E re-run is an open platform gate until the device (SM-S938W) is reconnected via adb/CDP.

## Unreleased — enterprise-readiness planning

- Added the enterprise-readiness roadmap and phase gates in `BUILD_PLAN.md`.
- Added the development progress tracker.
- Added contribution and conduct documents required for ASF gate review.
- Reconciled documentation status: peer chat, transport, identity exchange, PWA, storage, and backup claims require implementation evidence before release.
- Paused device chat testing pending baseline repair and Chat architecture/UX approval.

## 2.0.0 historical baseline

- **Session persistence:** Added `core/chat-session.js` with Double Ratchet state serialization/restore, sealed under the vault key in `chat-db.js` keyring (`peer_session:<contactId>`). `core/peer.js` now persists sessions after every send/decrypt, drops poisoned live sessions on decrypt failure (leaves envelope in relay for retry), and `clearPeerSessions()` clears persisted entries. `scripts/test-peer-session-resume.mjs` proves mid-chain ratchet state survives a desktop restart (red/green proven).
- **Phone↔desktop E2E proven:** Fixed production Bob identity (`rel_f5f9cf9b56dd429e97b485244b510a87`), fixed `phone-prod-sequenced.mjs` contact lookup and reply check. Full duplex verified over production Cloudflare relay: Bob→Phone ("hello-from-bob" received), Phone→Bob ("hello-from-phone" sent and received). Samsung SM-S938W WebView egress limitation cleared (fresh WebView workaround); phone reaches relay over external HTTPS without adb reverse (`scripts/test-device-egress.mjs` EXT_RELAY OK 200 1207ms; `scripts/test-device-queue.mjs` DEVICE_QUEUE_ROUNDTRIP_PASS).
- **Verification:** `npm run verify` PASS (parser 36 files, eslint, 73/73 suite, crypto 6/6, scrubber 2/2, relay-client 4/4, identity 4/4, chat-session 4/4, peer 2/2, SESSION_RESUME_PASS, relay contract/integration PASS); `npm run verify:browser` 17/17; `npm run verify:a11y` 0 violations; `npm run lint` PASS.

The prior 2.0.0 baseline included the local vault modules, OPFS/IndexedDB storage, service-worker packaging, Android packaging work, and crypto regression evidence. The enterprise-readiness review found that several advertised peer-chat and architecture claims exceed the currently wired runtime behavior; those claims are now treated as roadmap work until verified.
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `CONTRIBUTING.md`: portfolio PR-flow discipline (draft PR → tests green →
  owner merges; no direct pushes to main; CHANGELOG entry per PR; semver
  bumps; `vX.Y.Z` release tags).
- `NOTICE.md`: attribution.
- `CHANGELOG.md` itself (this file).
- SPDX license headers (`MIT`) on all first-party source files (core, ui,
  service worker, test suite, package script). Vendored `core/sqlite3.js` /
  `core/sqlite3.wasm` (SQLite WASM) intentionally left untouched.

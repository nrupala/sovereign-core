# Sovereign Core Enterprise Readiness Build Plan

Status: **REVIEW REQUIRED — documentation and planning only**

The roadmap was approved on 2026-09-08. Device chat testing remains paused. Phase 0 syntax repair is complete; Phase 1 quality foundation is in progress. This plan is the control document for the refactor.

## Product objective

Make Sovereign Core a trustworthy local-first workspace for ordinary users, healthcare and safety-critical professionals, security/AI engineers, and controlled corporate deployments. The product must be understandable without cryptographic knowledge, honest about its security boundary, usable on desktop, Android WebView, iOS Safari PWA, and testable end to end.

## Non-negotiable release principles

- No feature is advertised as implemented until an executable test proves it.
- No HIPAA, regulatory, or enterprise-compliance claim is made without a documented control mapping and deployment responsibility boundary.
- Chat is not called peer E2EE until identity, key exchange, transport, incoming messages, ratchet state, offline queue, and cross-device tests all pass.
- Security-sensitive actions are explicit, reversible where possible, and auditable locally.
- UI changes require a reviewed visual prototype before implementation.
- Every phase has an exit gate, evidence command, and rollback path.

## Phase 0 — Baseline freeze and truth reconciliation

**Goal:** establish a clean, truthful starting point before feature work.

Scope:
- Preserve current working tree and record the baseline.
- Repair the `SovereignApp.js` syntax error before any UI testing.
- Run parser checks on every runtime module, not only string-based tests.
- Inventory advertised claims against executable code.
- Mark Chat as local encrypted chat until peer integration exists.
- Correct README, user guide, walkthrough, architecture, communication, and metadata documents.

Exit evidence:
- `node --check ui/SovereignApp.js` passes.
- Browser boot smoke test passes with zero module-load errors.
- A claim matrix exists with implemented, partial, planned, and removed states.
- No device chat test is run before this gate.

Rollback:
- Restore the pre-refactor source from version control and retain the documentation-only audit.

## Phase 1 — Test and quality foundation

**Goal:** make false-green results impossible.

Scope:
- Replace static-only UI assertions with parser, import, browser, and interaction tests.
- Add tests for auth, lock, navigation, modal behavior, search, exports, contact CRUD, and destructive-action confirmation.
- Add `node --check`/module-import checks for all runtime ESM files.
- Add lint/typecheck commands and a reproducible test command.
- Add coverage thresholds appropriate to UI and crypto layers.
- Add CI checks that fail on syntax errors, broken imports, stale docs claims, and failing behavioral tests.

Exit evidence:
- Test suite exercises runtime behavior rather than only file strings.
- CI passes on a clean checkout.
- Coverage and known exceptions are recorded.

Rollback:
- Keep the existing suite as a compatibility check while restoring the last green test harness.

## Phase 2 — Trustworthy onboarding and information architecture

**Goal:** a new user can understand and safely use the app without external help.

Scope:
- First-run welcome: what the vault is, what stays local, what the password means, and what cannot be recovered.
- Password guidance and strength feedback without storing the password.
- Backup/export reminder at vault creation and before destructive actions.
- Render the promised vault identity/DNA or remove the claim.
- Create a real Home/Today view for tasks, habits, calendar, recent notes, journal, and chat status.
- Normalize navigation labels: `Peer Chat` and `Companion`, not duplicate `Chat` labels.
- Implement real global search or remove the Ctrl+K search promise.
- Add undo/toasts/status feedback and consistent empty states.

Exit evidence:
- Usability walkthrough succeeds for a first-time user on desktop, Android, and iOS Safari.
- All icon-only controls have labels, tooltips, and keyboard/touch paths.
- Destructive actions require clear confirmation and explain consequences.

Rollback:
- Feature-flag the Home view and retain the existing module navigation until parity is proven.

## Phase 3 — Chat product definition and identity model

**Goal:** decide and document the actual communication product before coding it.

Decision required:
- Recommended initial architecture: persistent cryptographic identity, contact invite via QR/text, a ciphertext-only WebSocket relay, per-contact ratchet sessions, local encrypted message store, offline queue, and explicit delivery state.
- Optional later transport: WebRTC/direct peer mode. It must not be required for the first reliable cross-device release.

Scope:
- Define identity lifecycle, contact invite/accept/revoke, fingerprint verification, device replacement, and recovery behavior.
- Define transport states: offline, connecting, connected, queued, delivered, failed.
- Define message model: outgoing/incoming, ratchet state, acknowledgements, attachments, retries, duplicate/replay handling.
- Decide whether the product uses Signal-style X3DH + Double Ratchet or another reviewed protocol. Do not describe the current vault-secret bootstrap as production E2EE.
- Define relay trust boundary and metadata minimization.
- Prototype the complete Chat UX visually and obtain approval before implementation.

Exit evidence:
- Approved sequence diagrams and UI prototype.
- Threat model and key lifecycle reviewed.
- Transport and deployment model documented for personal and corporate use.

Rollback:
- Keep local encrypted notes/chat available as a separate clearly labeled feature if peer chat is delayed.

## Phase 4 — Chat implementation

**Goal:** implement the approved peer-chat design end to end.

Scope:
- Persistent local identity keys.
- Contact invite/accept and fingerprint verification.
- Relay connection configuration with safe defaults and no embedded credentials.
- Real outgoing and incoming message paths.
- Per-contact ratchet state persistence and rotation.
- Offline queue, retry, duplicate suppression, delivery state, and reconnect behavior.
- Contact rename/remove/block and conversation deletion with explicit scope.
- Encrypted attachment path or remove the attachment control until implemented.
- No plaintext message content in relay or chat database.

Exit evidence:
- Two-browser, browser↔Android, and browser↔iOS-PWA tests pass.
- Wrong-key, replay, tamper, reconnect, offline queue, and contact revocation tests pass.
- Relay inspection confirms only permitted ciphertext/envelope metadata is visible.

Rollback:
- Disable peer transport behind a feature flag and retain local encrypted chat; never silently fall back while claiming peer E2EE.

## Phase 5 — Content, sharing, and operational workflows

**Goal:** make the app the user's reliable home for logging, tracking, and sharing.

Scope:
- Correct JSON/CSV/TXT/ICS export semantics and implement missing ICS export or remove it from all docs/UI.
- Implement Web Share/native share paths with warnings for plaintext exports.
- Repair or remove the no-op database backup path.
- Add encrypted backup bundles with explicit restore verification.
- Add attachment import and metadata inspection/scrubbing, or remove unsupported metadata claims.

Exit evidence:
- Every advertised export/import path is tested and documented.
- Plaintext exports show explicit warnings and require deliberate user action.
- Backup/restore is tested on clean installs and across vault versions.

Rollback:
- Remove unsupported share/backup controls from the UI until the workflow is implemented and verified.

## Phase 6 — Accessibility, PWA, mobile, and performance hardening

**Goal:** make the app polished, responsive, and usable by people with disabilities.

Scope:
- WCAG 2.1 AA review of auth, Home/Today, and all modules.
- Keyboard, screen-reader, focus, and color-contrast verification.
- Safe-area and viewport checks on desktop, Android WebView, and iOS Safari PWA.
- Performance profiling and startup/render budget.
- Service-worker cache-version strategy for upgrades.

Exit evidence:
- axe audit 0 violations across all reachable screens.
- Keyboard and screen-reader walkthrough succeeds.
- Mobile safe-area and responsive checks pass on representative devices.
- Startup, render, and interaction budgets recorded and met.

Rollback:
- Preserve the last green baseline and feature-flag incomplete UI changes until they meet the hardening gate.

## Phase 7 — Enterprise controls, security review, release evidence, and ASF gate closure

**Goal:** make the product trustworthy for controlled deployments and auditable release.

Scope:
- Final threat model, pentest, and residual-risk register.
- Dependency provenance and supply-chain evidence.
- Android release signing and enterprise distribution path.
- iOS PWA install and standalone verification.
- Documentation site build (Apple Developer-standard HTML) with CI verification.
- Release decision record and rollback plan.

Exit evidence:
- All applicable ASF gates PASS with observed evidence in `ASFQC/GATES.md`.
- Release artifacts are signed, versioned, and reproducible.
- Documentation accurately reflects executable behavior.
- Final release decision is recorded in the development progress tracker.

Rollback:
- Keep the release in review until every gate has observed evidence; do not ship with open high-severity findings or unsupported claims.
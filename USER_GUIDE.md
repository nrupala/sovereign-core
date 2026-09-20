# Sovereign Core User Guide — Review Baseline

## Current status

Sovereign Core is under enterprise-readiness review. This guide describes the implemented user experience. **Peer Chat is implemented and E2E-tested** (identity, invite exchange, relay transport, Double Ratchet, session persistence — desktop↔phone verified 2026-09-10, re-verified 2026-09-17; Cloudflare Worker relay local pentest 24/24 on 2026-09-19). Do not use the current build as evidence of HIPAA, regulatory, or enterprise compliance — release hardening (Android signing, iOS PWA, marketplace distribution) remains open.

## What the app is

Sovereign Core is intended to be a local-first workspace for tasks, notes, habits, ledger entries, journal entries, calendar views, analytics, a local Companion, and eventually verified peer communication.

Your vault password is the root of access. There is no password recovery service. Exported files may be plaintext and must be protected accordingly.

## Current vault behavior

- Create or select a vault from the lock screen.
- Unlock with the master password.
- Wrong passwords must leave the vault locked.
- Locking should clear the in-memory key and return to the authentication screen.
- Vault data is stored through OPFS with an IndexedDB fallback where supported.
- Android cloud backup is disabled in the packaged application.

## Home / Today

After unlock, Home is the starting point. It summarizes open tasks, habits, dated records, items needing attention, recent records, and Peer Chat status. A new empty vault shows a short Start here card with direct actions for creating a task, writing a note, or opening Help.

## Sections

- Tasks: capture and complete work.
- Notes: store structured or free-form information.
- Habits: record recurring check-ins.
- Ledger: record income and expenses.
- Journal: write dated reflections and mood entries.
- Calendar: view dated items.
- Analytics: review trends derived from local records.
- Companion: local assistant behavior; it is not a remote clinical or safety authority.
- Settings: retention, themes, and data controls.
- Peer Chat: currently local encrypted chat storage; peer-to-peer transport and identity exchange remain roadmap work.

## Chat status and future flow

The current Chat tab must not be treated as a completed desktop↔mobile messenger. The target flow is:

1. Create a persistent identity.
2. Add a contact by QR, invite, or verified public key.
3. Confirm the contact fingerprint.
4. Connect through an approved relay or later direct transport.
5. Send and receive messages with visible queued/delivered/failed state.
6. Remove, block, revoke, or replace a contact deliberately.

The target flow will be documented again after implementation and cross-device testing.

## Backup and sharing

Use the supported export format only after checking the current UI label and test evidence. Plaintext exports are portable but sensitive. Encrypted backup bundles and native share behavior remain roadmap items until verified on desktop, Android, and iOS PWA.

## Privacy and compliance boundary

The product is local-first and designed to reduce data exposure. That does not by itself establish HIPAA compliance, regulatory compliance, or enterprise readiness. Deployment organizations remain responsible for policies, access control, workforce training, incident response, retention, legal review, and applicable agreements.

## Help and support content required before release

The final guide must include first-run onboarding, password/backup warnings, every section's primary workflow, chat identity/contact flow, export/import warnings, troubleshooting, accessibility instructions, PWA installation, Android installation, and administrator/deployment guidance.

See `BUILD_PLAN.md` for the approved roadmap proposal.
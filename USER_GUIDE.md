# Sovereign Core User Guide — Review Baseline

## Current status

This guide describes Sovereign Core v2.1.0, the current release — sold as a one-time licence (see Licence), with the storage rework (SQLite, recovery key, encrypted backup) in progress and Google Play packaging still to come. It describes the implemented user experience. Peer-to-peer chat is **not** part of this product (owner decision, 2026-10-12): the Chat tab in the current build stores messages locally on this device only and contacts no peer or relay. Earlier revisions of this guide, and other repository documents, described a verified desktop↔phone messenger; that described a separate September 2026 research build — preserved on branch `laptop/september-build-20261012` under `recovered/september-www/`, with recorded claims that do not reproduce — and it was never the shipped app. The comms code is preserved as labelled R&D. Do not use the current build as evidence of HIPAA, regulatory, or enterprise compliance — release hardening (Android signing, iOS PWA, marketplace distribution) remains open.

## What the app is

Sovereign Core is a local-first workspace for tasks, notes, habits, ledger entries, journal entries, calendar views, analytics, and a local Companion. It is single-device by design: no account, no cloud, no sync, no telemetry.

Your vault password is the root of access. There is no password recovery service. Exported files may be plaintext and must be protected accordingly.

## Current vault behavior

- Create or select a vault from the lock screen.
- Unlock with the master password.
- Wrong passwords must leave the vault locked.
- Locking should clear the in-memory key and return to the authentication screen.
- Vault data is stored through OPFS with an IndexedDB fallback where supported.
- Android cloud backup is disabled in the packaged application.

## Licence

Sovereign Core is sold as a one-time US$49.99 licence. There is no subscription and no account.

**Buying.** Buy through the official payment link: https://buy.stripe.com/5kQ3cvc0GbEI4qH32C9Zm05. After payment, the claim page shows your licence key — copy it from there, or from the email copy when email delivery is provided. Keep the key somewhere safe; it is your proof of purchase.

**Activating.** Open the app and go to **Settings → Licence**, paste your key, and tap **Activate**. The key is checked on your device; the app does not contact a server to verify it, and activation works offline.

**Without a licence.** In the shipped configuration, creating a new vault requires an activated licence. Vaults you already have are not affected: they always open with their password and can always be exported. The licence never locks you out of your own data.

**Refunds.** If a purchase is refunded, its licence key is revoked and will no longer activate. Your existing vaults and data are not affected.

**Terms and support.** The terms that govern the product are in `TERMS.md`; the code licensing map is in `LICENSING.md`. For licence help, contact info@aimlds.org.

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
- Peer Chat: local encrypted chat storage on this device only. It does not send messages to anyone (see Chat status).

## Chat status

Peer-to-peer chat is not part of Sovereign Core (owner decision, 2026-10-12). The Chat tab in this build is a local encrypted notebook: messages are encrypted under your vault key and stored on this device; nothing is sent anywhere, and there is no contact, invite, or relay system in the shipped app. Do not rely on it to communicate with anyone, and do not treat anything in the app as a delivered message.

A peer-communications research build from September 2026 is preserved on branch `laptop/september-build-20261012` under `recovered/september-www/` for reference. If a communications product is ever built, it will be a separate product, documented when it exists and is verified.

## Backup and sharing

Use the supported export format only after checking the current UI label and test evidence. Plaintext exports are portable but sensitive. Encrypted backup bundles and native share behavior remain roadmap items until verified on desktop, Android, and iOS PWA.

## Privacy and compliance boundary

The product is local-first and designed to reduce data exposure. That does not by itself establish HIPAA compliance, regulatory compliance, or enterprise readiness. Deployment organizations remain responsible for policies, access control, workforce training, incident response, retention, legal review, and applicable agreements.

## Help and support content required before release

The final guide must include first-run onboarding, password/backup warnings, every section's primary workflow, export/import warnings, troubleshooting, accessibility instructions, PWA installation, Android installation, and administrator/deployment guidance.

See `BUILD_PLAN.md` for the approved roadmap proposal.
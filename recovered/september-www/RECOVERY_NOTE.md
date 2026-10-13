# Recovery note — September peer build snapshot

Recovered 2026-10-12 by Wright (Muse) from the laptop of Nrupal Akolkar:
`D:\research\sovereign-core\.apk-wrapper\www\` (the APK wrapper's packaged
copy of the app). The September peer build was never committed to the
repository's source tree — `git log --all -- core/peer.js` is empty — and the
repo root was reconciled back to the GitHub state on 2026-10-09, leaving
these wrapper copies as the only survivors. This directory preserves them
byte-for-byte under `recovered/september-www/` on branch
`laptop/september-build-20261012` so the build cannot be lost to a wrapper
clean/rebuild.

## What is here

The full September app payload: `core/peer.js`, `chat-identity.js`,
`chat-session.js`, `contact-meta.js`, `relay-client.js`, `peer-agent.mjs`
with their test files, plus the evolved `ui/SovereignApp.js` (Contacts tab,
Home view, peer wiring). Snapshot predates the 2026-09-20 analytics
determinism fix and the October certification SPDX pass.

## Verification summary (Wright, 2026-10-12, behaviour-run)

- This snapshot's `core/crypto.js` verifyPassword FAILS CLOSED — it already
  contained the fix (with a comment naming the self-test tautology). The
  any-password defect fixed on main by PR #5 was a regression introduced
  when the GitHub line was reconciled over this state.
- Unit tests in this snapshot: 54 total — 47 pass, 7 fail
  (analytics 7/9, peer 2/5, peer-reset 0/2; identity/session/contact-meta/
  relay-client/security/zeroization/scrubber suites fully green).
- The end-to-end relay exchange tests (Alice↔Bob through a relay) fail in
  the verification environment; the "73/73" and "device E2E PASS" claims in
  CHANGELOG/ASFQC-GATES.md are NOT verified by this snapshot.
- No pentest scripts or accessibility harness were found on the laptop
  (only docs/PENTEST_REPORT.md); those claims remain unverified.

Per the owner's 2026-10-12 ruling, peer chat is dropped from the sellable
product and this code is preserved as labelled R&D.

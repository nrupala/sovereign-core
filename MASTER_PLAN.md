# Sovereign Core — Master Plan

## Status

This document records the product vision and current truth boundary. Execution is paused pending roadmap approval. The executable delivery plan is `BUILD_PLAN.md`.

## Product vision

Sovereign Core is intended to be a local-first personal operating space for capture, tracking, reflection, private assistance, and verified communication. It must serve a common user without requiring cryptographic knowledge and remain precise enough for security, AI, safety-critical, healthcare, and corporate operators.

## Current implemented surface

The runtime application currently exposes Tasks, Notes, Habits, Ledger, Journal, Calendar, Analytics, Companion, Settings, authentication, encrypted vessel storage, and local chat storage. The cryptography and storage primitives are the strongest part of the current baseline.

## Current non-implemented or unverified surface

The following remain roadmap work, not shipped capabilities:

- complete peer-to-peer Chat,
- persistent user identity and contact verification,
- QR/invite-based key exchange,
- relay configuration and ciphertext-only transport,
- incoming message handling,
- offline delivery queue and acknowledgements,
- encrypted attachments,
- group messaging,
- real global search,
- verified ICS export,
- metadata inspection and sharing controls,
- production backup/restore bundles,
- enterprise administration and audit controls.

## Delivery roadmap

1. Baseline repair and claim reconciliation
2. Runtime test and CI foundation
3. Onboarding and information architecture
4. Chat architecture decision and UX prototype
5. Chat implementation and cross-device verification
6. Sharing, backup, content, and workflow completeness
7. Accessibility, PWA, mobile, and performance hardening
8. Enterprise controls, security review, release evidence, and ASF gate closure

Each phase is defined with exit evidence and rollback paths in `BUILD_PLAN.md`. No phase is complete based on intent or static file presence alone.

## Design principles

- Local-first by default
- Explicit security boundaries
- No hidden network behavior
- No unsupported compliance claims
- Simple user language over protocol language
- Reversible destructive actions
- Behavioral evidence over static assertions
- Prototype and review before user-facing UI implementation

## Historical vision sections

Earlier feature sketches for journal, chat, Companion, analytics, and Apple-level polish remain useful as ideas, but are not implementation evidence. They must be converted into approved requirements and tests before being described as product functionality.
# Hollow Vessel Architecture

## Status

The vessel model is the storage and encryption design. Some original claims were stronger than the current implementation and are corrected here.

## Implemented baseline

- Individual payloads are encrypted with AES-GCM and per-vessel IVs.
- The vault key is derived through PBKDF2 and is non-extractable in WebCrypto.
- OPFS is the preferred browser store with IndexedDB fallback.
- The chat database is isolated from the vault database.

## Metadata boundary that must be understood

The current `core/db.js` implementation writes a plaintext `.meta` sidecar containing operational fields such as type, tags, priority, and timestamps. Therefore the current implementation does **not** satisfy the stronger claim that all descriptive metadata is inside ciphertext and that an outside observer sees only an identifier and timestamp.

The product must either encrypt the sidecar metadata or explicitly document the fields exposed at rest. This decision requires threat-model review and migration planning.

## Communication boundary

A future communication layer may carry encrypted vessel or message payloads through a relay. The relay integration is not currently wired into the Chat UI. No production E2EE or zero-metadata transport claim is authorized until the communication roadmap passes its interoperability and threat-model gates.

## Required future evidence

- metadata sidecar inspection,
- migration test for existing vessels,
- tamper and corruption behavior,
- relay-visible envelope review,
- restore and rollback tests.

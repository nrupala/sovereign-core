# Sovereign Core Peer Chat Protocol

Status: **Phase 3 implementation baseline — relay, session, peer orchestration, and browser UI wiring verified locally; physical-device and production relay deployment completed** — peer E2E over production Cloudflare relay re-verified 2026-09-17 (device-present phone E2E PASS, Bob→Phone decrypt+save; Phone→Bob RECEIVED + WATCH_PASS).

This document defines the first interoperable peer-chat target. The relay queue contract, relationship/session primitives, peer orchestration, and Peer Chat UI wiring are implemented and covered by local tests. Physical Android/iOS-PWA interoperability and production relay deployment remain open gates.

## Product boundary

Peer Chat is a separate subsystem from Companion:

- Companion is local assistant interaction inside the user's vault.
- Peer Chat sends encrypted messages between verified identities.
- A relay transports ciphertext envelopes and limited routing metadata.
- The relay never receives vault keys or plaintext message content.

## Identity

Each relationship owns an independent cryptographic session identity. A future optional profile identity may exist, but it is not required for a private contact relationship. Relationship private keys never leave the device. A relationship identity includes:

- relationship ID,
- optional local display name,
- public session/bootstrap key,
- fingerprint derived from the canonical public key,
- created timestamp,
- relationship/replacement status.

Identity export is an explicit action. No private key is copied into a contact record or exported by default.

## Contact invite

A contact invite is a signed, human-shareable envelope containing:

- protocol version,
- identity ID,
- display name,
- public identity key,
- fingerprint,
- optional relay address,
- expiration,
- signature.

The recipient may scan a QR code, paste an invite, or accept a local invitation. Acceptance displays the fingerprint before the contact becomes active. A display name alone never establishes identity.

## Lifetime model

The security material has three different lifetimes:

- **Identity key:** created once per device/profile, sealed under the vault key, and used for contact verification. It remains stable until the user explicitly revokes or replaces the device.
- **Queue capabilities:** transport credentials for a mailbox relationship. They are session/transport controlled, revocable, and rotatable without changing the user's identity fingerprint. The relay applies bounded lifetime and message TTL.
- **Session keys:** ephemeral ratchet state for one contact relationship. They evolve continuously, are sealed at rest, and are discarded/re-established on revocation or device replacement.

Users should see identity verification and connection status. They should not see queue capabilities or ratchet keys.

## Session establishment

The first implementation must use a reviewed authenticated key-agreement flow that provides forward secrecy and post-compromise recovery. The existing Double Ratchet primitives are not sufficient by themselves to define the initial authenticated handshake.

Required session state:

- protocol version,
- contact identity ID,
- local and remote public identity keys,
- root key reference/state,
- sending and receiving chain state,
- skipped-message-key bounds,
- last received/send counters,
- session status and timestamps.

Session state is encrypted at rest and scoped to the local chat database.

## Envelope

The relay receives only an envelope similar to:

```json
{
  "version": 1,
  "type": "message",
  "recipient": "identity-id",
  "sender": "identity-id",
  "conversation": "conversation-id",
  "messageId": "unique-id",
  "createdAt": 0,
  "header": {},
  "ciphertext": "base64url",
  "signature": "base64url"
}
```

The exact header fields must be finalized with the cryptographic implementation review. Plaintext content, vault IDs, master-password material, and private keys are prohibited.

## Delivery states

Every outgoing message has one of:

- Draft
- Encrypting
- Queued offline
- Sending
- Delivered to relay
- Delivered to contact
- Failed
- Expired

The UI must never imply delivery to the recipient merely because local encryption succeeded.

## Relay contract

The first relay is a self-hostable WebSocket service with:

- authenticated connection using the chat identity protocol,
- ciphertext-only envelope forwarding,
- bounded message size,
- expiry and retry policy,
- duplicate message suppression,
- reconnect support,
- no plaintext logging,
- health and operational metrics that exclude message content.

The client must allow a configured relay endpoint and must show the active endpoint and connection state. No endpoint or credential is hardcoded into the product.

## Contact lifecycle

- Add: invite parsed, fingerprint shown, recipient accepts.
- Verify: fingerprint compared out of band and marked verified.
- Rename: local display-only operation.
- Block: stop outgoing/incoming delivery and retain explicit local status.
- Remove: remove local contact reference; conversation deletion is a separate decision.
- Revoke: invalidate the identity/session and require a new invite.
- Replace device: mark prior device untrusted and establish a new session.

## Offline behavior

Messages are encrypted locally and placed in an encrypted outbox. Reconnect retries with bounded backoff. Acknowledgements are authenticated and idempotent. The outbox must survive application restart but not expose plaintext.

## Required implementation tests

- Identity generation and persistence
- Invite creation, signature validation, expiry, and tamper rejection
- Fingerprint display and verification state
- Session establishment in two independent browser contexts
- Browser↔Android and browser↔iOS PWA message exchange
- Alice→Bob and Bob→Alice messages
- Relay sees no plaintext
- Offline queue, restart, reconnect, duplicate, timeout, and retry
- Replay, wrong-key, tamper, revoked-contact, and replaced-device rejection
- Conversation deletion versus contact removal semantics
- Attachment rejection until encrypted attachment support exists

## Release claim

The product may be described as peer E2EE Chat only after the protocol, relay, implementation, device interoperability, and security review gates pass. Until then, the UI and documentation must say **local encrypted Chat**.
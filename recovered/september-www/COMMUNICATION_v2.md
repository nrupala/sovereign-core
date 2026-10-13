# Sovereign Communication Architecture

## Status

The communication layer is an architecture proposal with library-level building blocks. It is not currently an end-to-end production chat service.

## Current components

- `core/broker.js` contains stanza encoding/decoding, BroadcastChannel loopback, and a WebSocket adapter.
- `core/sync.js` contains a separate WebSocket-oriented sync bus and ratchet envelope path.
- `core/double-ratchet.js` contains ratchet primitives tested in loopback/library tests.
- `core/chat-db.js` stores local contacts, conversations, messages, and attachments.

The application does not currently configure or activate a relay, persist a peer identity, exchange contact keys, or route incoming peer messages through the Chat tab.

## Target communication contract

The approved future design must define:

1. Persistent cryptographic identity per user/device.
2. Contact invite and acceptance through QR, text, or invite link.
3. Human-verifiable fingerprints or safety numbers.
4. Per-contact session establishment and ratchet state persistence.
5. Ciphertext-only relay transport.
6. Offline queue, reconnect, duplicate suppression, and delivery state.
7. Contact revoke/block and device replacement behavior.
8. Encrypted attachments only after the text path is proven.

A ciphertext-only WebSocket relay is the recommended first cross-device transport. Direct WebRTC can be evaluated later, but it requires its own signaling and NAT traversal design.

## Security boundary

The relay must not receive plaintext messages or vault keys. Transport encryption and application message encryption are separate controls. The server may still observe connection metadata unless the deployment design minimizes or accepts that exposure; this must be documented honestly.

## Current user-facing wording

Until the target contract is implemented and tested, the Chat UI must be described as local encrypted chat, not verified peer E2EE messaging. The Double Ratchet library tests prove cryptographic primitives, not product interoperability.

## Required evidence before release claims

- desktop↔desktop test,
- desktop↔Android test,
- desktop↔iOS PWA test,
- offline queue/reconnect test,
- wrong-key/tamper/replay tests,
- relay plaintext inspection,
- contact revocation and device replacement tests.

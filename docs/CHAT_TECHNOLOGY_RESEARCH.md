# Peer Chat Technology Research — SimpleX and XMPP

Status: **Research complete — SimpleX-inspired disposable mailbox transport adopted for implementation; peer chat verified E2E on production Cloudflare relay 2026-09-17 and local pentest 24/24 2026-09-19**

## Executive conclusion

Neither SimpleX nor XMPP provides cross-device messaging with only a contact name and no network service.

- **SimpleX:** no global user identifiers; uses client-generated one-time invitations and disposable relay queues. Servers are still involved in asynchronous delivery, but they do not need a global user directory.
- **XMPP:** decentralized client/server messaging; each client normally has a server-backed JID such as `user@domain/resource`. A server is required for normal cross-device delivery, even when self-hosted or isolated inside a company.
- **Direct device-to-device:** requires signaling and usually NAT traversal. A same-LAN assumption is not sufficient for general mobile/PWA use.

## SimpleX characteristics relevant to Sovereign Core

Verified from the SimpleX project documentation and repository:

- It advertises no user identifiers of any kind.
- A user shares a one-time invitation link or QR code to create a private connection.
- Messages pass through one or more disposable/simplex message queues.
- Relay servers temporarily hold messages until delivery and do not maintain a global user directory.
- Users can operate their own servers while communicating with users on other servers.
- The client owns contacts and message data; the relay is a transport/mailbox boundary.
- The model supports asynchronous delivery without requiring both clients to be online simultaneously.

This is closer to the desired Sovereign Core experience than the current contact-name/public-key placeholder flow.

## XMPP characteristics relevant to Sovereign Core

Verified from the XMPP Standards Foundation overview:

- XMPP is an open, decentralized XML streaming protocol.
- TLS and SASL provide channel security and authentication at the protocol layer.
- Presence and rosters are server-mediated concepts.
- XMPP addresses use a JID format and therefore introduce a persistent service identity.
- Multiple servers can federate like email, or an organization can run an isolated private server.
- End-to-end encryption is an additional application/protocol layer; XMPP transport alone is not E2EE.

XMPP is a good enterprise integration option, but it is not the best primary user experience for ordinary users who should not see JIDs, domains, rosters, or federation configuration.

## Recommended Sovereign Core direction

Adopt a **SimpleX-inspired disposable mailbox transport**, without copying its protocol or claiming compatibility:

1. Each contact relationship creates a pair of unidirectional, random mailbox addresses.
2. A one-time invite/QR contains only the information needed to establish the relationship and authenticate the peer.
3. There is no global user directory and no public permanent user address by default.
4. A relay stores only encrypted envelopes until delivery, then deletes them according to bounded retention.
5. Contacts and relationship keys remain client-owned.
6. Organizations may run their own relay service.
7. The UI shows a friendly contact name and verification status, not a JID or server identity.
8. The app can later support XMPP as an enterprise transport adapter, not as the default consumer UX.

## Important limitation

This still requires a relay for reliable cross-device asynchronous delivery. "No server" is possible only for:

- same-device/multi-tab loopback,
- direct local-network experiments,
- or a direct peer transport with signaling and NAT traversal.

A serverless promise would be misleading for iPhone↔desktop use across arbitrary networks.

## Decision required before implementation

The current protocol baseline should be revised from "persistent global device identity + generic relay" to:

- relationship-scoped identity,
- one-time invite/QR,
- disposable mailbox queues,
- optional verified display name,
- relay endpoint abstraction,
- authenticated E2EE session establishment,
- client-side offline outbox.

The cryptographic handshake still requires formal design review. Contact name remains presentation metadata, never authentication.

## Sources consulted

- SimpleX Chat project repository and README: `https://github.com/simplex-chat/simplex-chat`
- XMPP Standards Foundation technology overview: `https://xmpp.org/about/technology-overview/`
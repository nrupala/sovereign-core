# Codetopo Profile — Sovereign Core (nrupala/sovereign-core)

**What this is.** The agent-facing map of this repository, generated with
Codetopo 0.9.1 (local engine, `~/.cargo/bin/codetopo`) so an arriving agent
can see the machine — topology, trust boundaries, money surface — before it
submits or changes anything. Read this first; the graph snapshot beside it
(`snapshot.json`, `stats.json`) is the measured evidence.

- **Repo:** nrupala/sovereign-core
- **Commit profiled:** `7f26dc60d604c92f72861b7135d884d26d505c2e` (main)
- **Engine:** codetopo 0.9.1 · index run 2026-11-18
- **Graph:** 64 files walked · 0 failed · 3490 nodes · 8353 edges · audit chain valid (3 entries, head `2e833b71…b01d0`)
- **Nodes by kind:** external 2260 · variable 538 · function 338 · method 183 · file 64 · module 64 · doc 24 · class 18 · package 1
- **Edges by kind:** calls 4397 · reads 2043 · contains 1229 · defines 564 · writes 62 · imports 56 · inherits 2

## Coverage honesty

Codetopo extracts Rust, TypeScript/JavaScript and Python, plus Markdown as Doc nodes. Covered at symbol level: the JavaScript codebase (36 `.js` + 2 `.mjs` — `core/`, `ui/`, `billing/worker/`) — this is the bulk of the graph (1,077 symbols). The 24 Markdown files are indexed as Doc nodes only. NOT covered: the 2 Python files (repo tooling, not product code), the vendored `core/sqlite3.wasm` binary, HTML/CSS entry assets, and `billing/worker/wrangler.toml` (read it directly for the worker's bindings).

## Topology

A buildless, local-first encrypted workspace (README): tasks, notes, habits, ledger, journal, calendar, analytics and a local Companion — no account, no cloud, no sync, no telemetry in the shipped app; everything is stored on-device, encrypted under the user's vault password.

- `index.html` — the single browser entry point; `ui/SovereignApp.js` — the shipped application shell.
- `core/` — the engine modules: `crypto.js` (PBKDF2-HMAC-SHA-256 key derivation, AES-GCM, challenge verification), `db.js` (OPFS/IndexedDB vessel persistence), `chat-db.js` (isolated local chat storage — no transport wired to it), `keys.js`, `identity.js`, `license.js`, `store.js`, `analytics.js`, `companion.js` / `companion-engine.js`, `scrubber.js`, `intelligence.js`, `voice.js`. Unit tests sit beside the modules (`*.test.js`).
- `core/double-ratchet.js`, `core/broker.js`, `core/sync.js` — transport/ratchet building blocks, explicitly **research code, not a shipped feature** (README): nothing in the app sends messages anywhere; peer messaging is not part of the product (owner decision, 2026-10-12).
- `billing/worker/` — the one server-side component: a Cloudflare Worker (`worker.js` + pure-logic `lib.js`, tested by `lib.test.js`) that verifies Stripe webhooks and issues licences (see Money surface). `sw.js` provides offline caching.

## Trust boundaries

- **App data boundary:** the workspace itself is local-only — vault password-derived keys (`core/crypto.js`, `core/keys.js`) encrypt everything at rest on the device; no account or session exists in the app.
- **Billing worker boundary (the only place secrets exist, by NAME only):** the worker reads its secrets from the deployment environment, never from code (documented in `billing/worker/worker.js` header): `STRIPE_WEBHOOK_SECRET` (the deployment's own Stripe webhook signing secret — the ONLY secret webhook verification consults; the worker fails closed if it is unset), `LICENSE_SIGNING_KEY_JWK` (licence signing key), `OPERATOR_MINT_SECRET`, and `RESEND_API_KEY` (licence email delivery). Issuance bindings (expected payment link / amount / currency) are non-secret `wrangler.toml` vars. Licence records live in the worker's `LICENCES` KV namespace. One deployment trusts exactly one webhook secret — test and production deployments are fully separate (worker header, "one deployment, one webhook secret" invariant).
- **Blast radius:** `core/crypto.js` / `core/db.js` for the app; `billing/worker/lib.js` for money — its webhook verification and issuance logic is the highest-consequence code in the repo (4,397 call edges overall concentrate in `core/` + the worker).

## Money surface

Exactly one money path, and it is server-side licence issuance — the app itself never touches a card:

- **Stripe → webhook → licence.** The user pays on a Stripe-hosted Payment Link; Stripe delivers `checkout.session.completed` / `checkout.session.async_payment_succeeded` webhooks to the billing worker. `billing/worker/lib.js` verifies the Stripe webhook signature (`verifyStripeSignature…`), checks the session belongs to *this* product's checkout (expected payment link / amount / currency bindings), and issues a signed licence **idempotently** (Stripe may deliver the same event twice — issuance is keyed so a redelivery does not double-issue). `billing/worker/worker.js` wires the pure logic to the environment: secrets, the `LICENCES` KV store, and licence email delivery via Resend (`RESEND_API_KEY`, `MAIL_FROM`).
- `core/license.js` — the app-side counterpart that validates issued licences locally.
- No other payment, billing, checkout or spend surface exists in this repo (no Paddle, no in-app card handling, no Play Billing code found).

## How an agent should approach

1. Read `README.md`, then this profile, then the snapshot.
2. Use `codetopo` queries against the snapshot (descendants, blast-radius,
   symbol) before editing — especially around the hubs named above.
3. Do not add credentials, account identifiers or key material to any file
   here — names and paths only. Respect the trust boundaries above as
   design constraints, not suggestions.
4. Run the repo's own tests after any change; regenerate this profile
   (below) whenever the code changes.

## Regeneration

`docs/codetopo-profile/refresh.sh` (in this pack) re-downloads the repo
at a named ref, re-runs the index, and rewrites `snapshot.json`,
`stats.json` and the header block inputs of this profile. Regenerate at
every release / material change.

Release gate: NOT RUN — Guardian Mesh: NOT RUN (this profile pack is a
documentation artifact; it is not a release-gate or Guardian Mesh verdict).

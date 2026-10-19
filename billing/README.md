# Sovereign Core — billing issuer

The server side of Sovereign Core's one-time purchase. Sovereign Core
itself is local-first and account-free; this small Cloudflare Worker is
the *only* server component, and its whole job is turning a paid Stripe
checkout into a signed licence token the app can verify offline.

## How it works

```
Stripe checkout ──webhook──▶ Worker ──▶ KV (LICENCES)
                                │            │
                                │            ├─ session:<id>  licence record
                                │            ├─ kid:<kid>     licence index
                                │            ├─ pi:<pi>       payment-intent index
                                │            └─ blocklist     revoked kids
                                ├─ GET /claim?session=<id>   buyer claim page
                                ├─ GET /billing/blocklist    revocation feed for the app
                                └─ Resend email (optional)     licence key by email
```

1. The buyer pays through the Stripe payment link (below). Stripe fires
   `checkout.session.completed` (and, for delayed payment methods,
   `checkout.session.async_payment_succeeded`) at `POST /billing/webhook`.
2. The Worker verifies the Stripe signature, then checks the session
   against the issuance binding (below): only a live-mode, paid session
   for this product's own payment link, amount, and currency may mint.
   A matching-but-unpaid session is recorded as pending and mints
   nothing; any other product's session is ignored. On a qualifying
   session the Worker issues a licence: a random licence id (`kid`,
   32 hex chars) is embedded in a signed token and the record set is
   written to KV. Issuance is idempotent per checkout session, so
   duplicate deliveries return the same token.
3. Stripe redirects the buyer to `/claim?session=<checkout session id>`,
   which renders the token for copy-paste into the app
   (**Settings → Licence**). If `RESEND_API_KEY` is configured, the key
   is also emailed.
4. On `charge.refunded` **for a full refund**, the licence tied to
   that payment intent is revoked and its `kid` is added to the
   blocklist; a partial refund does not revoke. On
   `checkout.session.async_payment_failed`, any licence already issued
   for that session is clawed back the same way. The app polls
   `/billing/blocklist` and refuses blocklisted keys.

### The licence token

```
token     = base64url(JSON payload) + "." + base64url(signature)
signature = ECDSA P-256 / SHA-256 over the payload segment's ASCII
            bytes (WebCrypto encoding: raw r||s, 64 bytes)
payload   = {"v":1,"product":"sovereign-core","kid":"<32 hex>","iat":<unix seconds>}
```

The app verifies tokens offline against the public half of the signing
key embedded in `core/license.js`. The private half exists only as a
Worker secret.

## One deployment, one webhook secret

Webhook verification trusts exactly one secret: this deployment's own
`STRIPE_WEBHOOK_SECRET`. There is no fallback. Test-mode proofs run
against a **separate test deployment** — its own Worker, KV namespace,
and secrets, configured with the test endpoint's secret — never
against this deployment. (An earlier version of this issuer accepted
the test-mode secret as a fallback on the production deployment so a
proof could run against it; the release gate graded that Critical —
F-SC-1 — and the fallback is removed from the code, not just the
config.)

## Issuance binding

Issuance is bound to this product's checkout by plain config vars in
`worker/wrangler.toml` (`[vars]`):

| Var | Value | Meaning |
| --- | ----- | ------- |
| `EXPECTED_PAYMENT_LINK` | `plink_1USH4bEAiA4GKFhAQT5cHucQ` | The only payment link whose sessions may mint |
| `EXPECTED_AMOUNT_TOTAL` | `4999` | Session `amount_total` must equal this (US$49.99) |
| `EXPECTED_CURRENCY` | `usd` | Session currency must equal this |
| `EXPECTED_PRICE_ID` | `price_1USH4VEAiA4GKFhAt8s6JmkC` | Documented identity of the link's line item (the link sells exactly this price) |

A session mints only when **all** of these hold: `livemode` is true,
`payment_status` is `paid`, `payment_link` matches, `amount_total`
matches, `currency` matches. If any `EXPECTED_*` var is missing, the
issuer mints nothing — it fails closed. This matters because the
Stripe account is shared: the endpoint receives checkout events for
every product on the account, and none of them may mint a Sovereign
Core licence.

Two consequences of the binding:

- **Async claw-back.** If a delayed payment later fails
  (`checkout.session.async_payment_failed`) after a licence was
  issued, the licence for that session is revoked and blocklisted,
  and the failure is recorded.
- **Full-refund-only revocation.** `charge.refunded` revokes only
  when the charge's `refunded` flag is true (a full refund). A
  partial refund leaves the licence in force.

The claim layer carries its own guard on top of the claw-back: KV is
eventually consistent, so the claw-back's revocation write may not
have propagated by the time a buyer opens the claim page. Because the
failure itself is recorded unconditionally (`failed:<session id>`),
`/claim` checks for that record before showing anything — a session
with a recorded payment failure never displays a licence key, even
if its licence record still reads "active", and shows the
payment-failed page instead of the processing page when there is no
licence record at all.

## Live Stripe objects

| Object       | Value |
| ------------ | ----- |
| Product      | `prod_VTDV8IepRzX4AY` |
| Price        | `price_1USH4VEAiA4GKFhAt8s6JmkC` (US$49.99, one-time) |
| Payment link | https://buy.stripe.com/5kQ3cvc0GbEI4qH32C9Zm05 |

## Files

| File | Role |
| ---- | ---- |
| `worker/lib.js` | Pure issuer logic (Stripe signature verification, issuance, revocation). No Worker globals; unit-tested in Node. |
| `worker/worker.js` | Worker entry: routes, KV adapter, claim pages, email leg. |
| `worker/wrangler.toml` | Worker config. KV ids are placeholders until deploy. |
| `worker/lib.test.js` | `node --test` suite for the logic and the handler. |

`worker.js` imports `lib.js` as an ES module; Wrangler resolves the
import at deploy time, so there is no separate build step.

## Secrets

Set at deploy with `wrangler secret put <NAME>` — **never committed**:

| Secret | Required | Purpose |
| ------ | -------- | ------- |
| `STRIPE_WEBHOOK_SECRET` | yes | Verifies Stripe webhook signatures (`whsec_...`). Issued when the live webhook endpoint is created in Stripe. |
| `LICENSE_SIGNING_KEY_JWK` | yes | Licence signing private key, as a JWK JSON string. Generated at deploy (see below). |
| `RESEND_API_KEY` | no | Enables the licence-key email leg. Without it, buyers get their key from the claim page only. |
| `MAIL_FROM` | no | Sender for the licence email. Defaults to `Sovereign Core <info@aimlds.org>`. |

## ⚠️ Test keypair warning

`worker/lib.test.js` contains a **TEST-ONLY** ECDSA keypair so tests can
sign and verify against a known key. It is labelled TEST wherever it
appears and must never be used in production: a production deployment
signs with a fresh keypair generated at deploy time, whose private half
is stored only as the `LICENSE_SIGNING_KEY_JWK` Worker secret and whose
public half replaces the key in `core/license.js` in the deploy commit.

## Deploy

1. **Create the KV namespace** and put its ids in `worker/wrangler.toml`
   (replacing the placeholders):
   ```sh
   npx wrangler kv namespace create LICENCES
   npx wrangler kv namespace create LICENCES --preview
   ```
2. **Generate the production signing keypair** (private half goes to the
   Worker secret in the next step; public half goes into
   `core/license.js` in the deploy commit):
   ```sh
   node -e "crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']).then(async k=>{console.log('PRIVATE (LICENSE_SIGNING_KEY_JWK secret):');console.log(JSON.stringify(await crypto.subtle.exportKey('jwk',k.privateKey)));console.log('PUBLIC (core/license.js):');console.log(JSON.stringify(await crypto.subtle.exportKey('jwk',k.publicKey)));})"
   ```
3. **Set the secrets**:
   ```sh
   cd billing/worker
   npx wrangler secret put LICENSE_SIGNING_KEY_JWK   # paste the private JWK
   npx wrangler secret put RESEND_API_KEY            # optional
   ```
   (`STRIPE_WEBHOOK_SECRET` comes in step 5.)
4. **Deploy the Worker** and attach the custom domain
   (e.g. `billing.aimlds.org`, see the commented route in
   `wrangler.toml`):
   ```sh
   npx wrangler deploy
   ```
5. **Create the live Stripe webhook endpoint** pointing at
   `https://<domain>/billing/webhook` for the events
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, and `charge.refunded`.
   After this skeleton is deployed, the main chat creates the endpoint
   and lands its signing secret:
   ```sh
   npx wrangler secret put STRIPE_WEBHOOK_SECRET     # the endpoint's whsec_ value
   ```
6. **Point the payment link at the claim page**: set the Stripe payment
   link's post-payment redirect to `https://<domain>/claim?session={CHECKOUT_SESSION_ID}`
   so buyers land on their key.
7. **Smoke-test**: `GET /health` returns `ok`. Run test-mode proofs
   against a separate test deployment of this Worker (its own KV and
   secrets, including the test endpoint's webhook secret) — never
   against production: confirm the claim page shows a token the app
   accepts, then refund it and confirm the kid appears at
   `/billing/blocklist` on that deployment.

## Tests

```sh
node --test billing/worker/lib.test.js   # or: npm run test:unit
```

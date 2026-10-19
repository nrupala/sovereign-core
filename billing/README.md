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
2. The Worker verifies the Stripe signature, then issues a licence:
   a random licence id (`kid`, 32 hex chars) is embedded in a signed
   token and the record set is written to KV. Issuance is idempotent
   per checkout session, so duplicate deliveries return the same token.
3. Stripe redirects the buyer to `/claim?session=<checkout session id>`,
   which renders the token for copy-paste into the app
   (**Settings → Licence**). If `RESEND_API_KEY` is configured, the key
   is also emailed.
4. On `charge.refunded`, the licence tied to that payment intent is
   revoked and its `kid` is added to the blocklist. The app polls
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

## Live Stripe objects

| Object       | Value |
| ------------ | ----- |
| Product      | `prod_VTDV8IepRzX4AY` |
| Price        | `price_1USH4VEAiA4GKFhAt8s6JmkC` (US$49.99, one-time) |
| Payment link | https://buy.stripe.com/5kQ3cvc0GbEIbT9bz89Zm05 |

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
7. **Smoke-test**: `GET /health` returns `ok`; run a test-mode purchase
   end to end and confirm the claim page shows a token the app accepts,
   then refund it and confirm the kid appears at `/billing/blocklist`.

## Tests

```sh
node --test billing/worker/lib.test.js   # or: npm run test:unit
```

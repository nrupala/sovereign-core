/**
 * billing/worker/lib.test.js
 *
 * Node tests for the Sovereign Core billing issuer (lib.js logic plus the
 * worker.js fetch handler driven with a fake KV namespace).
 * Run: node --test billing/worker/lib.test.js
 *
 * Keys: the TEST-ONLY keypair below is a throwaway pair used solely so
 * tests can sign and verify against a known key. It is NOT the production
 * signing key — the production keypair is generated at deploy time and
 * its private half is never committed (see billing/README.md).
 * TEST ONLY below this line wherever the key material appears.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import {
  verifyStripeSignature,
  signToken,
  issueLicence,
  markSessionFailed,
  revokeByPaymentIntent,
  getBlocklist,
} from "./lib.js";
import worker from "./worker.js";

// TEST ONLY — throwaway keypair for tests/dev. Never a production key.
const TEST_PUBLIC_JWK = {
  kty: "EC", crv: "P-256",
  x: "ty_kP2zAS2fxy3AKhAgdi7_MMsy4rUxWPbqNiuR3c08",
  y: "AgeAnftHm4ZVDtJYDutzDMBckUG_tQK_v1cKZ4xUnt4",
};
// TEST ONLY — private half of the throwaway pair above, tests/dev only.
const TEST_PRIVATE_JWK = {
  kty: "EC", crv: "P-256",
  x: "ty_kP2zAS2fxy3AKhAgdi7_MMsy4rUxWPbqNiuR3c08",
  y: "AgeAnftHm4ZVDtJYDutzDMBckUG_tQK_v1cKZ4xUnt4",
  d: "4YVHZjMGAkfHHYG7JTXGI23zPvr-9-N7B2HIz5fGjXU",
};

const WEBHOOK_SECRET = "whsec_test_only_not_a_real_secret";

/** In-memory store adapter over a Map (same interface as the KV adapter). */
function memStore() {
  const map = new Map();
  return {
    map,
    async get(k) { return map.has(k) ? map.get(k) : null; },
    async put(k, v) { map.set(k, String(v)); },
  };
}

/** Fake KV namespace binding backed by a memStore, for worker tests. */
function fakeEnv() {
  const store = memStore();
  return {
    store,
    env: {
      LICENCES: { get: store.get, put: store.put },
      STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
      LICENSE_SIGNING_KEY_JWK: JSON.stringify(TEST_PRIVATE_JWK), // TEST ONLY key
    },
  };
}

function stripeHeader(rawBody, secret, ts) {
  const v1 = createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");
  return `t=${ts},v1=${v1}`;
}

function webhookRequest(rawBody, secret = WEBHOOK_SECRET, ts = Math.floor(Date.now() / 1000)) {
  return new Request("https://billing.example/billing/webhook", {
    method: "POST",
    headers: { "stripe-signature": stripeHeader(rawBody, secret, ts) },
    body: rawBody,
  });
}

function eventBody(type, object) {
  return JSON.stringify({ id: "evt_test", type, data: { object } });
}

const COMPLETED = eventBody("checkout.session.completed", {
  id: "cs_test_123",
  customer_details: { email: "buyer@example.com" },
  payment_intent: "pi_123",
});

/* ---------------- Stripe signature verification ---------------- */

test("verifyStripeSignature accepts a correctly signed payload", async () => {
  const body = COMPLETED;
  const now = Math.floor(Date.now() / 1000);
  const header = stripeHeader(body, WEBHOOK_SECRET, now);
  assert.equal(await verifyStripeSignature(body, header, WEBHOOK_SECRET, now), true);
});

test("verifyStripeSignature rejects a tampered body", async () => {
  const now = Math.floor(Date.now() / 1000);
  const header = stripeHeader(COMPLETED, WEBHOOK_SECRET, now);
  const tampered = COMPLETED.replace("buyer@example.com", "attacker@example.com");
  assert.equal(await verifyStripeSignature(tampered, header, WEBHOOK_SECRET, now), false);
});

test("verifyStripeSignature rejects a stale timestamp", async () => {
  const now = Math.floor(Date.now() / 1000);
  const stale = now - 3600;
  const header = stripeHeader(COMPLETED, WEBHOOK_SECRET, stale);
  assert.equal(await verifyStripeSignature(COMPLETED, header, WEBHOOK_SECRET, now), false);
});

test("verifyStripeSignature rejects the wrong secret", async () => {
  const now = Math.floor(Date.now() / 1000);
  const header = stripeHeader(COMPLETED, "whsec_some_other_secret", now);
  assert.equal(await verifyStripeSignature(COMPLETED, header, WEBHOOK_SECRET, now), false);
});

test("verifyStripeSignature rejects missing/garbled headers", async () => {
  const now = Math.floor(Date.now() / 1000);
  assert.equal(await verifyStripeSignature(COMPLETED, null, WEBHOOK_SECRET, now), false);
  assert.equal(await verifyStripeSignature(COMPLETED, "not-a-signature", WEBHOOK_SECRET, now), false);
});

/* ---------------- Token contract ---------------- */

test("issued token verifies against the TEST public key and matches the contract shape", async () => {
  const store = memStore();
  const { licence } = await issueLicence(store, {
    sessionId: "cs_shape", email: "a@b.c", paymentIntent: "pi_shape",
  }, TEST_PRIVATE_JWK);

  const [payloadSeg, sigSeg] = licence.token.split(".");
  assert.ok(payloadSeg && sigSeg, "token has two segments");

  const payload = JSON.parse(Buffer.from(payloadSeg, "base64url").toString("utf8"));
  assert.equal(payload.v, 1);
  assert.equal(payload.product, "sovereign-core");
  assert.match(payload.kid, /^[0-9a-f]{32}$/);
  assert.equal(payload.kid, licence.kid);
  assert.equal(typeof payload.iat, "number");

  const sig = Buffer.from(sigSeg, "base64url");
  assert.equal(sig.length, 64, "WebCrypto raw r||s signature is 64 bytes");
  const pub = await crypto.subtle.importKey(
    "jwk", TEST_PUBLIC_JWK, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]
  );
  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" }, pub, sig, new TextEncoder().encode(payloadSeg)
  );
  assert.equal(ok, true);
});

test("signToken round-trips an arbitrary payload", async () => {
  const token = await signToken({ v: 1, product: "sovereign-core", kid: "ab".repeat(16), iat: 123 }, TEST_PRIVATE_JWK);
  const [payloadSeg] = token.split(".");
  const payload = JSON.parse(Buffer.from(payloadSeg, "base64url").toString("utf8"));
  assert.equal(payload.iat, 123);
});

/* ---------------- Issuance ---------------- */

test("issueLicence is idempotent per session: same kid/token, one record set", async () => {
  const store = memStore();
  const first = await issueLicence(store, {
    sessionId: "cs_idem", email: "buyer@example.com", paymentIntent: "pi_idem",
  }, TEST_PRIVATE_JWK);
  const second = await issueLicence(store, {
    sessionId: "cs_idem", email: "buyer@example.com", paymentIntent: "pi_idem",
  }, TEST_PRIVATE_JWK);

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.licence.kid, first.licence.kid);
  assert.equal(second.licence.token, first.licence.token);
  assert.deepEqual(
    [...store.map.keys()].sort(),
    [`kid:${first.licence.kid}`, "pi:pi_idem", "session:cs_idem"]
  );
  const kidRec = JSON.parse(await store.get(`kid:${first.licence.kid}`));
  assert.deepEqual(kidRec, { sessionId: "cs_idem", status: "active" });
  assert.equal(await store.get("pi:pi_idem"), first.licence.kid);
});

test("markSessionFailed records the failure and creates no licence", async () => {
  const store = memStore();
  await markSessionFailed(store, "cs_failed");
  assert.equal(await store.get("session:cs_failed"), null);
  const failed = JSON.parse(await store.get("failed:cs_failed"));
  assert.equal(failed.status, "failed");
});

/* ---------------- Revocation ---------------- */

test("revokeByPaymentIntent flips both records and blocklists the kid", async () => {
  const store = memStore();
  const { licence } = await issueLicence(store, {
    sessionId: "cs_refund", email: "buyer@example.com", paymentIntent: "pi_refund",
  }, TEST_PRIVATE_JWK);

  const result = await revokeByPaymentIntent(store, "pi_refund");
  assert.equal(result.revoked, true);
  assert.equal(result.kid, licence.kid);
  assert.equal(result.sessionId, "cs_refund");

  const sessionRec = JSON.parse(await store.get("session:cs_refund"));
  assert.equal(sessionRec.status, "revoked");
  const kidRec = JSON.parse(await store.get(`kid:${licence.kid}`));
  assert.equal(kidRec.status, "revoked");
  assert.deepEqual(await getBlocklist(store), [licence.kid]);
});

test("revokeByPaymentIntent on an unknown payment intent changes nothing", async () => {
  const store = memStore();
  const result = await revokeByPaymentIntent(store, "pi_unknown");
  assert.equal(result.revoked, false);
  assert.deepEqual(await getBlocklist(store), []);
});

/* ---------------- Worker handler ---------------- */

test("worker: webhook with a bad signature gets 400 and issues nothing", async () => {
  const { env, store } = fakeEnv();
  const res = await worker.fetch(webhookRequest(COMPLETED, "whsec_wrong"), env, {});
  assert.equal(res.status, 400);
  assert.equal(store.map.size, 0);
});

test("worker: test-mode secret is accepted as fallback when the live secret does not match", async () => {
  const { env, store } = fakeEnv();
  env.STRIPE_WEBHOOK_SECRET = "whsec_live_placeholder_not_matching";
  env.STRIPE_WEBHOOK_SECRET_TEST = "whsec_test_mode_secret";
  const res = await worker.fetch(webhookRequest(COMPLETED, "whsec_test_mode_secret"), env, {});
  assert.equal(res.status, 200);
  const licence = JSON.parse(await store.get("session:cs_test_123"));
  assert.equal(licence.status, "active");
});

test("worker: checkout.session.completed issues a licence; claim page shows the token", async () => {
  const { env, store } = fakeEnv();
  const res = await worker.fetch(webhookRequest(COMPLETED), env, {});
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { received: true });

  const licence = JSON.parse(await store.get("session:cs_test_123"));
  assert.equal(licence.status, "active");
  assert.equal(licence.email, "buyer@example.com");
  assert.equal(licence.paymentIntent, "pi_123");

  const claim = await worker.fetch(new Request("https://billing.example/claim?session=cs_test_123"), env, {});
  assert.equal(claim.status, 200);
  assert.equal(claim.headers.get("Cache-Control"), "no-store");
  assert.equal(claim.headers.get("X-Robots-Tag"), "noindex");
  const html = await claim.text();
  assert.ok(html.includes(licence.token), "claim page shows the token");
  assert.ok(html.includes("Sovereign Core"), "claim page names the product");
  assert.ok(html.includes("Settings"), "claim page gives activation steps");
});

test("worker: completing the same session twice issues exactly one licence", async () => {
  const { env, store } = fakeEnv();
  await worker.fetch(webhookRequest(COMPLETED), env, {});
  const again = eventBody("checkout.session.async_payment_succeeded", {
    id: "cs_test_123",
    customer_details: { email: "buyer@example.com" },
    payment_intent: "pi_123",
  });
  const res = await worker.fetch(webhookRequest(again), env, {});
  assert.equal(res.status, 200);
  const sessions = [...store.map.keys()].filter((k) => k.startsWith("session:"));
  assert.deepEqual(sessions, ["session:cs_test_123"]);
});

test("worker: async_payment_failed records the failure and issues no licence", async () => {
  const { env, store } = fakeEnv();
  const body = eventBody("checkout.session.async_payment_failed", { id: "cs_late_fail" });
  const res = await worker.fetch(webhookRequest(body), env, {});
  assert.equal(res.status, 200);
  assert.equal(await store.get("session:cs_late_fail"), null);
  assert.equal(JSON.parse(await store.get("failed:cs_late_fail")).status, "failed");
});

test("worker: charge.refunded revokes; claim shows revoked; blocklist lists the kid", async () => {
  const { env, store } = fakeEnv();
  await worker.fetch(webhookRequest(COMPLETED), env, {});
  const licence = JSON.parse(await store.get("session:cs_test_123"));

  const refund = eventBody("charge.refunded", { id: "ch_123", payment_intent: "pi_123" });
  const res = await worker.fetch(webhookRequest(refund), env, {});
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(await store.get("session:cs_test_123")).status, "revoked");

  const claim = await worker.fetch(new Request("https://billing.example/claim?session=cs_test_123"), env, {});
  const html = await claim.text();
  assert.ok(/revoked/i.test(html), "claim page shows the revoked notice");
  assert.ok(!html.includes(licence.token), "revoked claim page must not show the token");

  const bl = await worker.fetch(new Request("https://billing.example/billing/blocklist"), env, {});
  assert.equal(bl.status, 200);
  assert.equal(bl.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await bl.json(), { revoked: [licence.kid] });
});

test("worker: unknown claim session shows the processing page; health is ok", async () => {
  const { env } = fakeEnv();
  const claim = await worker.fetch(new Request("https://billing.example/claim?session=cs_nope"), env, {});
  assert.equal(claim.status, 200);
  assert.ok(/still processing/i.test(await claim.text()));

  const health = await worker.fetch(new Request("https://billing.example/health"), env, {});
  assert.equal(health.status, 200);
  assert.equal(await health.text(), "ok");
});

test("worker: unknown event types are acknowledged with 200 and ignored", async () => {
  const { env, store } = fakeEnv();
  const body = eventBody("payment_intent.created", { id: "pi_whatever" });
  const res = await worker.fetch(webhookRequest(body), env, {});
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { received: true });
  assert.equal(store.map.size, 0);
});

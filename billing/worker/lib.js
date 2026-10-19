/**
 * billing/worker/lib.js
 *
 * Pure licence-issuer logic for Sovereign Core billing.
 *
 * No Worker globals are used in this module: storage is an injected async
 * string store ({ get(key), put(key, value) }) and crypto is the standard
 * WebCrypto API (globalThis.crypto.subtle), available in both Cloudflare
 * Workers and Node 20+. worker.js adapts Cloudflare KV to the store
 * interface; lib.test.js adapts an in-memory Map.
 *
 * Licence token contract (shared with the app side, core/license.js):
 *   token     = base64url(JSON payload) + "." + base64url(signature)
 *   signature = ECDSA P-256 / SHA-256 over the payload segment's ASCII
 *               bytes, WebCrypto encoding (raw r||s, 64 bytes)
 *   payload   = {"v":1,"product":"sovereign-core","kid":"<32 hex chars>",
 *                "iat":<unix seconds>}
 */

export const PRODUCT = "sovereign-core";

const enc = new TextEncoder();

/** base64url-encode a byte array (no padding). */
export function base64urlEncode(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function bytesToHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string comparison (length is not treated as secret). */
function timingSafeEqualStr(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verify a Stripe webhook signature.
 *
 * Stripe scheme: header "t=<unix>,v1=<hex hmac>[,v1=...]"; the signed
 * payload is "<t>.<rawBody>"; the MAC is HMAC-SHA256 keyed with the
 * webhook signing secret. Rejects on missing parts, a timestamp outside
 * +/- toleranceSec of nowSec, or no v1 candidate matching.
 *
 * @returns {Promise<boolean>}
 */
export async function verifyStripeSignature(rawBody, sigHeader, secret, nowSec, toleranceSec = 300) {
  if (typeof rawBody !== "string" || !sigHeader || !secret) return false;
  let ts = null;
  const v1s = [];
  for (const part of String(sigHeader).split(",")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k === "t") ts = v;
    else if (k === "v1") v1s.push(v);
  }
  if (!ts || v1s.length === 0) return false;
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) return false;
  if (Math.abs(nowSec - tsNum) > toleranceSec) return false;
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${ts}.${rawBody}`));
  const expected = bytesToHex(new Uint8Array(mac));
  return v1s.some((v) => timingSafeEqualStr(v.toLowerCase(), expected));
}

/**
 * Sign a licence payload object per the token contract.
 * @returns {Promise<string>} the full token
 */
export async function signToken(payloadObj, privateJwk) {
  const payloadSeg = base64urlEncode(enc.encode(JSON.stringify(payloadObj)));
  const key = await crypto.subtle.importKey(
    "jwk", privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, key, enc.encode(payloadSeg)
  );
  return `${payloadSeg}.${base64urlEncode(new Uint8Array(sig))}`;
}

/**
 * Issuance binding (F-SC-2): the identity half of the binding — the
 * session belongs to THIS product's checkout when livemode, the payment
 * link, the amount, and the currency all match the expected values
 * configured for this deployment (EXPECTED_* in wrangler.toml). Pure;
 * any missing or mismatched field fails closed.
 */
export function sessionMatchesBinding(session, expected) {
  if (!session || !expected) return false;
  if (!expected.paymentLink || !expected.currency) return false;
  const expectedAmount = Number(expected.amountTotal);
  if (!Number.isFinite(expectedAmount)) return false;
  const sessionAmount = Number(session.amount_total);
  if (!Number.isFinite(sessionAmount)) return false;
  return (
    session.livemode === true &&
    session.payment_link === expected.paymentLink &&
    sessionAmount === expectedAmount &&
    session.currency === expected.currency
  );
}

/**
 * Full issuance qualification: the session matches the binding identity
 * AND the payment has actually cleared (payment_status 'paid'). True
 * only when every condition holds — no partial credit, no defaults
 * that pass.
 */
export function sessionQualifiesForIssuance(session, expected) {
  if (!session) return false;
  return sessionMatchesBinding(session, expected) && session.payment_status === "paid";
}

/** Random licence id: 16 random bytes as 32 lowercase hex chars. */
export function generateKid() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

/**
 * Issue a licence for a completed checkout session. Idempotent per
 * sessionId: if a licence already exists for the session it is returned
 * unchanged (Stripe may deliver the same session on both
 * checkout.session.completed and checkout.session.async_payment_succeeded).
 *
 * Store records written:
 *   session:<sessionId>  -> licence JSON {kid, token, email,
 *                            paymentIntent, status:'active', createdAt}
 *   kid:<kid>            -> {sessionId, status:'active'}
 *   pi:<paymentIntent>   -> kid            (only when paymentIntent given)
 *
 * @returns {Promise<{licence: object, created: boolean}>}
 */
export async function issueLicence(store, { sessionId, email, paymentIntent }, privateJwk) {
  const existingRaw = await store.get(`session:${sessionId}`);
  if (existingRaw) {
    return { licence: JSON.parse(existingRaw), created: false };
  }
  const kid = generateKid();
  const iat = Math.floor(Date.now() / 1000);
  const token = await signToken({ v: 1, product: PRODUCT, kid, iat }, privateJwk);
  const licence = {
    kid,
    token,
    email: email ?? null,
    paymentIntent: paymentIntent ?? null,
    status: "active",
    createdAt: new Date().toISOString(),
  };
  await store.put(`session:${sessionId}`, JSON.stringify(licence));
  await store.put(`kid:${kid}`, JSON.stringify({ sessionId, status: "active" }));
  if (paymentIntent) await store.put(`pi:${paymentIntent}`, kid);
  return { licence, created: true };
}

/** Record a session whose async payment failed. No licence is created. */
export async function markSessionFailed(store, sessionId) {
  await store.put(
    `failed:${sessionId}`,
    JSON.stringify({ sessionId, status: "failed", at: new Date().toISOString() })
  );
}

/**
 * Record a session that matches the binding identity but has not been
 * paid yet (e.g. a delayed payment method still clearing). No licence
 * is created; issuance waits for checkout.session.async_payment_succeeded
 * to arrive with the session fully qualified.
 */
export async function markSessionPending(store, sessionId) {
  await store.put(
    `pending:${sessionId}`,
    JSON.stringify({ sessionId, status: "pending", at: new Date().toISOString() })
  );
}

/**
 * Shared revocation mechanics: flip the kid and session records to
 * status 'revoked' and add the kid to the `blocklist` array record the
 * app polls. Idempotent — re-revoking changes nothing further.
 */
async function revokeKid(store, kid, sessionId) {
  const kidRaw = await store.get(`kid:${kid}`);
  const kidRec = kidRaw ? JSON.parse(kidRaw) : {};
  const sid = sessionId ?? kidRec.sessionId ?? null;
  await store.put(`kid:${kid}`, JSON.stringify({ ...kidRec, sessionId: sid, status: "revoked" }));
  if (sid) {
    const sRaw = await store.get(`session:${sid}`);
    if (sRaw) {
      const licence = JSON.parse(sRaw);
      licence.status = "revoked";
      await store.put(`session:${sid}`, JSON.stringify(licence));
    }
  }
  const blocklist = await getBlocklist(store);
  if (!blocklist.includes(kid)) {
    blocklist.push(kid);
    await store.put("blocklist", JSON.stringify(blocklist));
  }
  return sid;
}

/**
 * Revoke the licence tied to a payment intent (refund path).
 *
 * @returns {Promise<{revoked: boolean, kid?: string, sessionId?: string, reason?: string}>}
 */
export async function revokeByPaymentIntent(store, paymentIntent) {
  if (!paymentIntent) return { revoked: false, reason: "no payment intent" };
  const kid = await store.get(`pi:${paymentIntent}`);
  if (!kid) return { revoked: false, reason: "no licence for payment intent" };
  const sessionId = await revokeKid(store, kid, null);
  return { revoked: true, kid, sessionId };
}

/**
 * Revoke the licence issued for a checkout session (async-payment
 * claw-back path, F-SC-3). Looks the licence up through the
 * session:<id> record issueLicence wrote. Idempotent.
 *
 * @returns {Promise<string|null>} the revoked kid, or null when the
 * session has no licence.
 */
export async function revokeBySession(store, sessionId) {
  if (!sessionId) return null;
  const raw = await store.get(`session:${sessionId}`);
  if (!raw) return null;
  let licence;
  try {
    licence = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!licence.kid) return null;
  await revokeKid(store, licence.kid, sessionId);
  return licence.kid;
}

/** Read the blocklist array record (empty array when unset/corrupt). */
export async function getBlocklist(store) {
  const raw = await store.get("blocklist");
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

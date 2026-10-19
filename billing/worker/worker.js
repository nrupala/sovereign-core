/**
 * billing/worker/worker.js
 *
 * Cloudflare Worker entry for the Sovereign Core billing issuer.
 * All decision logic lives in lib.js; this file only adapts the Worker
 * environment (env secrets, the LICENCES KV namespace) to lib's store
 * interface and renders the claim pages.
 *
 * Routes:
 *   POST /billing/webhook     Stripe webhook (signature-verified)
 *   GET  /claim?session=<id>  buyer-facing licence claim page
 *   GET  /billing/blocklist   JSON {"revoked":[kid,...]} for the app
 *   GET  /health              "ok"
 *
 * Secrets (set at deploy via `wrangler secret put`, never committed):
 *   STRIPE_WEBHOOK_SECRET      this deployment's Stripe webhook endpoint
 *                              signing secret — the ONLY secret webhook
 *                              verification ever trusts here
 *   LICENSE_SIGNING_KEY_JWK    licence signing private key (JWK JSON)
 *   RESEND_API_KEY             optional; enables the licence email leg
 *   MAIL_FROM                  optional; defaults to the AIMLDS address
 *
 * INVARIANT — one deployment, one webhook secret: a deployment trusts
 * exactly one webhook secret, its own. Test-mode proofs run against a
 * separate test deployment with its own Worker, KV, and secrets; a
 * test-mode secret is never trusted here, and no fallback exists.
 * (The previous fallback to a test secret on the production deployment
 * was release-gate finding F-SC-1, Critical; it is removed, not
 * configured off.)
 *
 * Issuance binding (wrangler.toml [vars], not secrets):
 *   EXPECTED_PAYMENT_LINK / EXPECTED_AMOUNT_TOTAL / EXPECTED_CURRENCY
 *   identify the one checkout this issuer may mint for. A checkout
 *   session mints only when it fully qualifies against that binding
 *   (see sessionQualifiesForIssuance in lib.js); if any EXPECTED_* var
 *   is missing, nothing mints — the issuer fails closed.
 */

import {
  verifyStripeSignature,
  issueLicence,
  revokeByPaymentIntent,
  revokeBySession,
  markSessionFailed,
  markSessionPending,
  sessionMatchesBinding,
  sessionQualifiesForIssuance,
  getBlocklist,
} from "./lib.js";

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
const HTML_HEADERS = { "Content-Type": "text/html; charset=utf-8", ...NO_STORE };

/** Adapt the LICENCES KV namespace to lib's async string store. */
function kvStore(env) {
  return {
    get: (k) => env.LICENCES.get(k),
    put: (k, v) => env.LICENCES.put(k, v),
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function page(title, bodyHtml) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} — Sovereign Core</title>
<style>
  body { font-family: system-ui, sans-serif; background: #0a0a0a; color: #e8e8e8; margin: 0; padding: 2rem 1rem; }
  main { max-width: 36rem; margin: 0 auto; }
  h1 { font-size: 1.4rem; }
  pre { background: #161616; border: 1px solid #333; border-radius: 8px; padding: 1rem; white-space: pre-wrap; word-break: break-all; }
  button { background: #e8e8e8; color: #0a0a0a; border: 0; border-radius: 6px; padding: 0.5rem 1rem; cursor: pointer; }
  .muted { color: #9a9a9a; }
</style>
</head>
<body><main>${bodyHtml}</main></body>
</html>`;
}

function claimTokenPage(licence, emailConfigured) {
  return page("Your licence key", `
    <h1>Sovereign Core — your licence key</h1>
    <p>Thank you for your purchase. Your licence key:</p>
    <pre id="licence-token">${escapeHtml(licence.token)}</pre>
    <p><button type="button" onclick="navigator.clipboard && navigator.clipboard.writeText(document.getElementById('licence-token').textContent)">Copy licence key</button></p>
    <h2>Activate it</h2>
    <ol>
      <li>Open the Sovereign Core app.</li>
      <li>Go to <strong>Settings → Licence</strong>.</li>
      <li>Paste the key above and save.</li>
    </ol>
    <p class="muted">Keep this key somewhere safe — it is the only copy of your licence.
    ${emailConfigured ? "A copy was also sent to your email address." : ""}</p>`);
}

function claimRevokedPage() {
  return page("Licence revoked", `
    <h1>Sovereign Core</h1>
    <p>This licence has been revoked (for example, because the purchase was refunded),
    so it can no longer be activated.</p>
    <p class="muted">If you believe this is a mistake, contact support at info@aimlds.org.</p>`);
}

function claimProcessingPage() {
  return page("Payment processing", `
    <h1>Sovereign Core</h1>
    <p>Your payment is still processing, so your licence key is not ready yet.
    This page will show your key as soon as the payment clears — try again in a few minutes.</p>
    <p class="muted">If this persists, contact support at info@aimlds.org with your checkout details.</p>`);
}

/** Email the licence key via Resend, when configured. Never throws. */
async function sendLicenceEmail(env, licence, sessionId, origin) {
  if (!env.RESEND_API_KEY || !licence.email) return;
  const claimUrl = `${origin}/claim?session=${encodeURIComponent(sessionId)}`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.MAIL_FROM || "Sovereign Core <info@aimlds.org>",
        to: licence.email,
        subject: "Your Sovereign Core licence key",
        text: [
          "Thank you for purchasing Sovereign Core.",
          "",
          "Your licence key:",
          licence.token,
          "",
          "Activate it: open the Sovereign Core app, go to Settings -> Licence, and paste the key.",
          "",
          `You can also view this key any time at: ${claimUrl}`,
          "",
          "Keep this email — it is a copy of your licence.",
        ].join("\n"),
      }),
    });
    if (!res.ok) console.error("licence email failed: Resend HTTP", res.status);
  } catch (err) {
    console.error("licence email failed:", err);
  }
}

async function handleWebhook(request, env, ctx) {
  const rawBody = await request.text();
  const sigHeader = request.headers.get("stripe-signature");
  const now = Math.floor(Date.now() / 1000);
  // One deployment, one webhook secret (see header): verification uses
  // env.STRIPE_WEBHOOK_SECRET only. If it is unset, fail closed —
  // nothing is processed.
  if (!env.STRIPE_WEBHOOK_SECRET) {
    console.error("billing webhook: STRIPE_WEBHOOK_SECRET is not configured");
    return new Response("webhook secret not configured", { status: 500 });
  }
  const ok = await verifyStripeSignature(rawBody, sigHeader, env.STRIPE_WEBHOOK_SECRET, now);
  if (!ok) return new Response("invalid signature", { status: 400 });

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("invalid payload", { status: 400 });
  }

  const store = kvStore(env);
  const obj = event.data?.object ?? {};

  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      // Issuance binding (F-SC-2): mint only for a session that fully
      // qualifies against this deployment's EXPECTED_* binding. If the
      // binding is not configured, mint nothing (fail closed).
      const expected = expectedBinding(env);
      if (expected && sessionQualifiesForIssuance(obj, expected)) {
        const signingKey = JSON.parse(env.LICENSE_SIGNING_KEY_JWK);
        const { licence, created } = await issueLicence(store, {
          sessionId: obj.id,
          email: obj.customer_details?.email ?? obj.customer_email ?? null,
          paymentIntent: obj.payment_intent ?? null,
        }, signingKey);
        if (created) {
          const mail = sendLicenceEmail(env, licence, obj.id, new URL(request.url).origin);
          if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(mail);
          else await mail;
        }
      } else if (expected && sessionMatchesBinding(obj, expected)) {
        // Our checkout, but the payment has not cleared (e.g. a delayed
        // payment method): record it as pending and DO NOT mint. The
        // async_payment_succeeded delivery mints once it qualifies.
        await markSessionPending(store, obj.id);
      }
      // Anything else is another product's session on the shared Stripe
      // account (or an unconfigured binding): ignore it entirely.
      break;
    }
    case "checkout.session.async_payment_failed":
      // Claw-back (F-SC-3): if a licence was already issued for this
      // session, revoke it; the failure is recorded either way.
      await revokeBySession(store, obj.id);
      await markSessionFailed(store, obj.id);
      break;
    case "charge.refunded":
      // F-SC-7 decision: revocation is full-refund-only. A partial
      // refund (refunded === false, amount_refunded > 0) does NOT
      // revoke the licence.
      if (obj.refunded === true) {
        await revokeByPaymentIntent(store, obj.payment_intent);
      }
      break;
    default:
      // Unknown event types are acknowledged and ignored.
      break;
  }
  return Response.json({ received: true });
}

/**
 * The issuance binding from deployment config. Returns null when any
 * part is missing or malformed — callers must mint nothing then.
 */
function expectedBinding(env) {
  const paymentLink = env.EXPECTED_PAYMENT_LINK;
  const currency = env.EXPECTED_CURRENCY;
  const amountRaw = env.EXPECTED_AMOUNT_TOTAL;
  if (!paymentLink || !currency || amountRaw === undefined || amountRaw === null || amountRaw === "") {
    return null;
  }
  const amountTotal = Number(amountRaw);
  if (!Number.isFinite(amountTotal)) return null;
  return { paymentLink, amountTotal, currency };
}

async function handleClaim(url, env) {
  const sessionId = url.searchParams.get("session");
  if (!sessionId) {
    return new Response(
      page("Licence key", `
        <h1>Sovereign Core</h1>
        <p>No checkout session was provided with this link, so there is no licence to show.</p>
        <p class="muted">Use the claim link from your checkout confirmation, or contact support at info@aimlds.org.</p>`),
      { headers: HTML_HEADERS }
    );
  }
  const raw = await kvStore(env).get(`session:${sessionId}`);
  if (!raw) return new Response(claimProcessingPage(), { headers: HTML_HEADERS });
  const licence = JSON.parse(raw);
  if (licence.status === "revoked") {
    return new Response(claimRevokedPage(), { headers: HTML_HEADERS });
  }
  return new Response(claimTokenPage(licence, Boolean(env.RESEND_API_KEY)), { headers: HTML_HEADERS });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/health") {
        return new Response("ok", { status: 200, headers: { "Content-Type": "text/plain" } });
      }
      if (request.method === "POST" && url.pathname === "/billing/webhook") {
        return await handleWebhook(request, env, ctx);
      }
      if (request.method === "GET" && url.pathname === "/claim") {
        return await handleClaim(url, env);
      }
      if (request.method === "GET" && url.pathname === "/billing/blocklist") {
        const revoked = await getBlocklist(kvStore(env));
        return Response.json({ revoked }, { headers: NO_STORE });
      }
      return new Response("not found", { status: 404 });
    } catch (err) {
      console.error("billing worker error:", err);
      return new Response("internal error", { status: 500 });
    }
  },
};

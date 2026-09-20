# Sovereign Core — Installation Instructions

Prerequisites and step-by-step installation for the local workspace, the reference relay, and the packaged Android app. This repo is buildless by design for the browser path (ESM only, no bundler).

## Prerequisites

- **Node.js** 20+ (CI uses Node 24). Verify: `node --version`
- **npm** (ships with Node). Verify: `npm --version`
- **Git** to clone the repository.
- **Google Chrome** (any Chromium-family browser) for browser-smoke and a11y gates; `puppeteer-core` connects to your installed Chrome, so Chrome must be installed for `npm run verify:browser` and `npm run verify:a11y`.
- For the Android path: Android SDK with `platforms;android-36`, and `adb` for device installation.
- For the Cloudflare relay path: `wrangler` (npm devDependency) and a Cloudflare account/authentication (optional; not needed for local verification).

## 1. Clone and install

```pwsh
git clone <repository-url> D:\research\sovereign-core
cd D:\research\sovereign-core
npm install
```

`npm install` brings in dev dependencies only (`eslint`, `globals`, `puppeteer-core`, `wrangler`, `axe-core`). The runtime has zero external dependencies.

## 2. Verify the install

```pwsh
npm run verify
```

Expected result at the tail: `Verification passed. Browser/device/PWA checks remain separate platform gates.`

If the parser step reports a missing/incorrect file, re-run `npm install` and confirm the working directory is the repo root.

## 3. Run the app if you want to use it interactively

```pwsh
node scripts/static-dev-server.mjs
# open http://127.0.0.1:8765/
```

## 4. Run the reference relay (local queue service)

```pwsh
npm run relay:start
```

or directly:

```pwsh
node relay/node/server.mjs
```

Listens for the Node relay on port `8787` (configurable), health at `http://127.0.0.1:8787/healthz`. It persists queues in SQLite (`relay.sqlite` in the working directory by default).

## 5. Deploy the Cloudflare relay (production path)

Prerequisite: authenticated `wrangler`.

```pwsh
npm run relay:cf:dry     # dry-run deploy (validates config)
npm run relay:cf:dev     # local emulation on :8788
wrangler deploy --config relay/cloudflare/wrangler.jsonc   # production
```

The deployed Worker URL becomes your relay `baseUrl` (e.g. `https://sovereign-relay.<your-subdomain>.workers.dev`).

## 6. Android (debug APK) path

The repo packages a Capacitor wrapper under `.apk-wrapper/`:

```pwsh
node scripts/configure-capacitor-android.js .apk-wrapper/android
```

Then build with the Android Gradle toolchain (`./gradlew assembleDebug` under `.apk-wrapper/android`) and install on a device via `adb install`. Device verification uses a connected Android device and CDP; see `scripts/test-device-egress.mjs` and `scripts/test-device-queue.mjs` for the device probes.

## 7. Post-install verification checklist

| Check | Command | Pass condition |
|---|---|---|
| Parser | `npm run verify` | 36 files parsed, 73/73 suite |
| Lint | `npm run lint` | ESLint clean |
| Browser smoke | `npm run verify:browser` | 19/19 checks |
| Accessibility | `npm run verify:a11y` | 0 axe violations |
| Cloudflare relay | `node scripts/pentest-relay-cf.mjs` | 24/24 defended |
| Android | `node scripts/configure-capacitor-android.js .apk-wrapper/android` | Capacitor config complete |
# Contributing to Sovereign Core

Sovereign Core ships by the **portfolio PR-flow discipline** — this is the
per-update certification. Direct pushes to `main` are retired. Every change
goes:

**draft PR → tests green → owner merges**

## Process

1. Branch from `main` (`feature/<short-name>` or `fix/<short-name>`).
2. Open the PR as **DRAFT** while work is in flight.
3. Make sure tests pass (see below); mark the PR ready when green.
4. **Each PR adds a `CHANGELOG.md` entry under `## [Unreleased]`** describing
   what changed (Added / Changed / Fixed).
5. Bump the version where versioning exists. This repo tracks its version in
   `README.md` ("Sovereign Core v2.0"); if a `package.json`/`VERSION` file is
   ever added, bump semver PATCH for fixes, MINOR for features in the same PR.
6. The owner merges. Merge commits reference the PR number (e.g.
   `Merge pull request #N`). Releases are tagged `vX.Y.Z` after merge.

## Run / test (verified against repo docs)

No build step — this is a buildless native-ESM app. Serve the directory:

```
python -m http.server 8931
# open http://127.0.0.1:8931/
```

Tests:

```
node --input-type=module -e "import('./test-suite.js')"   # 69/69 (Node 20+)
node --test core/scrubber.test.js                          # 2/2
```

## Deploys

Sovereign Core is a static PWA: production is this directory served as the
site root (Pages or any static host), plus `bash package-pwa-apk.sh` for the
Android/APK packager. Deploys must be signed via the portfolio signed-deploy
wrapper before/after they go live (Worker-focused today; static/Pages targets
are being extended). Never ship a production asset through an unsigned path.

## License

MIT — see `LICENSE`. Keep the SPDX header line on every source file.

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `CONTRIBUTING.md`: portfolio PR-flow discipline (draft PR → tests green →
  owner merges; no direct pushes to main; CHANGELOG entry per PR; semver
  bumps; `vX.Y.Z` release tags).
- `NOTICE.md`: attribution.
- `CHANGELOG.md` itself (this file).
- SPDX license headers (`MIT`) on all first-party source files (core, ui,
  service worker, test suite, package script). Vendored `core/sqlite3.js` /
  `core/sqlite3.wasm` (SQLite WASM) intentionally left untouched.

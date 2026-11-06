#!/usr/bin/env node
// Stage the Sovereign Core app surface into www/ for Capacitor.
//
// The repo root is the buildless PWA, but it also carries billing code,
// tests, docs, and repo tooling that must NOT ship inside the Android app.
// This script copies only the runtime app surface — the same subset the
// old package-pwa-apk.sh wrapper was meant to carry — into www/, which
// capacitor.config.json points webDir at.
//
// Usage: node scripts/stage-www.mjs   (run from the repo root)

import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'www');

const FILES = [
  'index.html',
  'manifest.json',
  'sw.js',
  'favicon.ico',
  'icon-192.png',
  'icon-512.png',
];

// Whole directories that are pure runtime surface.
const DIRS = ['ui'];

// core/ is runtime surface except its test files.
const DIRS_FILTERED = ['core'];
const skip = (src) => src.endsWith('.test.js');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

for (const f of FILES) {
  const src = join(root, f);
  if (!existsSync(src)) throw new Error(`stage-www: missing required app file: ${f}`);
  cpSync(src, join(out, f));
}

for (const d of DIRS) {
  cpSync(join(root, d), join(out, d), { recursive: true });
}

for (const d of DIRS_FILTERED) {
  cpSync(join(root, d), join(out, d), { recursive: true, filter: (src) => !skip(src) });
}

console.log('stage-www: app surface staged into www/');

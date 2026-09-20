#!/usr/bin/env python3
"""Verify the Sovereign Core docs site build is complete and valid."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS_DIR = ROOT / "docs"
OUTPUT_DIR = ROOT / "docs-site"

REQUIRED_PAGES = [
    "index.html",
    "quick-start-guide.html",
    "install-instructions.html",
    "configuration-instructions.html",
    "deployment-guide.html",
    "CHAT_PROTOCOL.html",
    "CHAT_TECHNOLOGY_RESEARCH.html",
    "gates.html",
]

REQUIRED_ASSETS = ["styles.css", "script.js"]

REQUIRED_MANIFEST_KEYS = ["version", "generated_from", "pages"]


def verify():
    errors = []

    # Check output directory exists
    if not OUTPUT_DIR.exists():
        errors.append("docs-site/ directory does not exist")
        return errors

    # Check required pages exist
    for page in REQUIRED_PAGES:
        page_path = OUTPUT_DIR / page
        if not page_path.exists():
            errors.append(f"Missing page: {page}")
        elif page_path.stat().st_size < 1024:
            errors.append(f"Page too small (possible stub): {page} ({page_path.stat().st_size} bytes)")

    # Check required assets exist
    for asset in REQUIRED_ASSETS:
        asset_path = OUTPUT_DIR / asset
        if not asset_path.exists():
            errors.append(f"Missing asset: {asset}")

    # Check manifest exists and is valid
    manifest_path = OUTPUT_DIR / "manifest.json"
    if not manifest_path.exists():
        errors.append("Missing manifest.json")
    else:
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            for key in REQUIRED_MANIFEST_KEYS:
                if key not in manifest:
                    errors.append(f"Manifest missing key: {key}")
            # Check that manifest pages match required pages
            manifest_pages = [p["url"] for p in manifest.get("pages", [])]
            for page in REQUIRED_PAGES:
                if page not in manifest_pages:
                    errors.append(f"Manifest does not list required page: {page}")
        except json.JSONDecodeError as e:
            errors.append(f"Invalid manifest.json: {e}")

    # Check source markdown files exist
    required_sources = [
        DOCS_DIR / "quick-start-guide.md",
        DOCS_DIR / "install-instructions.md",
        DOCS_DIR / "configuration-instructions.md",
        DOCS_DIR / "deployment-guide.md",
        DOCS_DIR / "CHAT_PROTOCOL.md",
        DOCS_DIR / "CHAT_TECHNOLOGY_RESEARCH.md",
    ]
    for src in required_sources:
        if not src.exists():
            errors.append(f"Missing source markdown: {src}")
        elif src.stat().st_size < 500:
            errors.append(f"Source markdown too small (possible stub): {src}")

    return errors


if __name__ == "__main__":
    errors = verify()
    if errors:
        print("DOCS VERIFICATION FAILED:", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        sys.exit(1)
    else:
        print("Docs verification passed. All pages present and valid.")
        sys.exit(0)

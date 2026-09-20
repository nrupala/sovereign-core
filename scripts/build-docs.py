#!/usr/bin/env python3
"""Build the Sovereign Core documentation site from Markdown."""

from __future__ import annotations

import html
import json
import re
from pathlib import Path

import markdown
from jinja2 import Environment, FileSystemLoader, select_autoescape

ROOT = Path(__file__).resolve().parents[1]
DOCS_DIR = ROOT / "docs"
OUTPUT_DIR = ROOT / "docs-site"

NAV_GROUPS = [
    {
        "title": "Getting Started",
        "pages": [
            ("quick-start-guide", "Quick Start Guide", "bolt.rectangle"),
            ("install-instructions", "Installation Instructions", "arrow.down.doc"),
            ("configuration-instructions", "Configuration Instructions", "slider.horizontal.3"),
        ],
    },
    {
        "title": "Platform",
        "pages": [
            ("deployment-guide", "Deployment Guide", "square.and.arrow.up"),
        ],
    },
    {
        "title": "Peer Chat",
        "pages": [
            ("CHAT_PROTOCOL", "Chat Protocol", "message"),
            ("CHAT_TECHNOLOGY_RESEARCH", "Technology Research", "network"),
        ],
    },
    {
        "title": "Quality & Security",
        "pages": [
            ("gates", "ASF Quality Gates", "shield.lefthalf.filled"),
        ],
    },
]

THEME = {
    "light": {
        "accent": "#0071e3",
        "bg": "#ffffff",
        "surface": "#f5f5f7",
        "text": "#1d1d1f",
        "secondary": "#6e6e73",
        "border": "#d2d2d7",
        "code_bg": "#1d1d1f",
        "code_text": "#f5f5f7",
    },
    "dark": {
        "accent": "#2997ff",
        "bg": "#000000",
        "surface": "#1c1c1e",
        "text": "#f5f5f7",
        "secondary": "#98989d",
        "border": "#38383a",
        "code_bg": "#161617",
        "code_text": "#f5f5f7",
    },
}


def load_pages():
    pages = []
    for md_path in sorted(DOCS_DIR.glob("*.md")):
        text = md_path.read_text(encoding="utf-8")
        title_match = re.search(r"^#\s+(.+)$", text, re.MULTILINE)
        title = title_match.group(1).strip() if title_match else md_path.stem
        pages.append(
            {
                "id": md_path.stem,
                "title": title,
                "slug": md_path.stem,
                "path": md_path,
            }
        )
    gates = ROOT / "ASFQC" / "GATES.md"
    if gates.exists():
        text = gates.read_text(encoding="utf-8")
        title_match = re.search(r"^#\s+(.+)$", text, re.MULTILINE)
        title = title_match.group(1).strip() if title_match else "ASF Quality Gates"
        pages.append(
            {
                "id": "gates",
                "title": title,
                "slug": "gates",
                "path": gates,
            }
        )
    return pages


def render_markdown(text):
    body = markdown.markdown(
        text,
        extensions=[
            "extra",
            "tables",
            "fenced_code",
            "toc",
            "sane_lists",
            "smarty",
        ],
        output_format="html5",
    )
    body = body.replace("<h1>", '<h1 class="page-title">', 1)
    return body


def build_site():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    pages = load_pages()
    env = Environment(
        loader=FileSystemLoader(str(ROOT / "scripts" / "templates")),
        autoescape=select_autoescape(["html", "xml"]),
        trim_blocks=True,
        lstrip_blocks=True,
    )
    template = env.get_template("page.html")

    # Copy static assets
    templates = ROOT / "scripts" / "templates"
    for asset in ["styles.css", "script.js"]:
        src = templates / asset
        dst = OUTPUT_DIR / asset
        dst.write_bytes(src.read_bytes())

    for page in pages:
        text = page["path"].read_text(encoding="utf-8")
        body = render_markdown(text)
        output = template.render(
            page=page,
            body=body,
            nav_groups=NAV_GROUPS,
            theme=THEME,
            all_pages=pages,
            version="2.0",
        )
        output_path = OUTPUT_DIR / f"{page['slug']}.html"
        output_path.write_text(output, encoding="utf-8")

    manifest = {
        "version": "2.0",
        "generated_from": "docs/*.md and ASFQC/GATES.md",
        "pages": [
            {
                "id": "index",
                "title": "Sovereign Core Documentation",
                "url": "index.html",
            },
        ]
    }
    manifest["pages"].extend(
        [
            {
                "id": p["id"],
                "title": p["title"],
                "url": f"{p['slug']}.html",
            }
            for p in pages
        ]
    )
    (OUTPUT_DIR / "manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8"
    )

    index = template.render(
        page={"id": "index", "title": "Sovereign Core Documentation", "slug": "index"},
        body=render_markdown(
            "# Sovereign Core Documentation\n\n"
            "This site documents the current verified state of Sovereign Core, "
            "including setup, configuration, deployment, peer chat, and quality gates.\n\n"
            "## Start here\n\n"
            "- [Quick Start Guide](quick-start-guide.html) — get running in under five minutes.\n"
            "- [Installation Instructions](install-instructions.html) — prerequisites and install steps.\n"
            "- [Configuration Instructions](configuration-instructions.html) — scripts, relays, and environment variables.\n"
            "- [Deployment Guide](deployment-guide.html) — browser, Android, and Cloudflare relay deployment.\n"
            "- [Chat Protocol](CHAT_PROTOCOL.html) — identity, invite, relay, session, and delivery contract.\n"
            "- [Technology Research](CHAT_TECHNOLOGY_RESEARCH.html) — SimpleX and XMPP comparison.\n"
            "- [ASF Quality Gates](gates.html) — gate tracker and observed evidence.\n"
        ),
        nav_groups=NAV_GROUPS,
        theme=THEME,
        all_pages=pages,
        version="2.0",
    )
    (OUTPUT_DIR / "index.html").write_text(index, encoding="utf-8")

    print(f"Built {len(pages) + 1} pages into {OUTPUT_DIR}")


if __name__ == "__main__":
    build_site()

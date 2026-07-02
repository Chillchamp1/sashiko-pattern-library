#!/usr/bin/env python3
"""
Assembles src/ files into the self-contained deliverable.

Usage:
    python build.py

Output: Sashiko — Pattern Library.htm  +  index.html  (identical)
"""

import os
from datetime import datetime, timezone

SRC = "src"
OUTPUTS = ["Sashiko — Pattern Library.htm", "index.html"]

JS_FILES = [
    "patterns.js",
    "engine-star.js",
    "engine-hm.js",
    "engine-polyline.js",
    "render.js",
    "generator.js",
    "gallery.js",
    "experimental.js",
    "cad-engine.js",
    "download.js",
]


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def main():
    html = read(os.path.join(SRC, "template.html"))
    css  = read(os.path.join(SRC, "styles.css"))

    js_parts = []
    for fname in JS_FILES:
        content = read(os.path.join(SRC, fname))
        js_parts.append(f"// ── {fname} ──────────────────────────────\n{content}")
    js = "\n\n".join(js_parts)

    html = html.replace("<!-- INJECT:styles.css -->", css)
    html = html.replace("<!-- INJECT:scripts -->", js)

    # Inject backup seed data so offline / file:// also has patterns
    backup_json = read("backup-patterns.json")
    html = html.replace("<!-- INJECT:backup.json -->", backup_json)

    # Build stamp (visible in the About panel) so a deployed version is identifiable —
    # if the live date differs from what a browser shows, that browser is serving a cache.
    # DATE-ONLY on purpose: a same-day local build and the CI rebuild are then byte-identical,
    # so CI's "commit built files" step is a no-op (no churn / rebase conflicts on every push).
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    html = html.replace("<!-- INJECT:buildstamp -->", stamp)

    for out in OUTPUTS:
        with open(out, "w", encoding="utf-8") as f:
            f.write(html)
        print(f"  wrote {out}")

    total_src = sum(
        len(read(os.path.join(SRC, f)).splitlines())
        for f in JS_FILES + ["styles.css", "template.html"]
    )
    print(f"  {len(html.splitlines())} lines total  ({total_src} lines across {len(JS_FILES)+2} source files)")


if __name__ == "__main__":
    main()

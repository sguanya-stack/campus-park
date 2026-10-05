#!/usr/bin/env python3
"""
Render a Markdown report into a single self-contained HTML file.

Self-contained on purpose: no CDN links, no external fonts, no JS. The
output is one file that opens offline in any browser, renders Chinese
correctly, prints cleanly to PDF (Cmd-P), and can be emailed as-is.

Usage:
  python3 make_report_html.py PROGRESS_REPORT.md
  python3 make_report_html.py PROGRESS_REPORT.md -o out.html --title "..."
"""

import argparse
import datetime as _dt
from pathlib import Path

import re

import markdown

CSS = """
:root { --ink:#1a1a1a; --muted:#5a6675; --rule:#d9dee5; --accent:#2f5d8a;
        --bg:#ffffff; --code-bg:#f5f7fa; --warn-bg:#fff8e6; --warn-br:#e0b23c; }
* { box-sizing: border-box; }
body {
  margin: 0 auto; max-width: 860px; padding: 56px 40px 96px;
  background: var(--bg); color: var(--ink);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
               "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
  font-size: 16px; line-height: 1.75; -webkit-font-smoothing: antialiased;
}
h1 { font-size: 1.85em; line-height: 1.3; margin: 0 0 .2em;
     border-bottom: 3px solid var(--accent); padding-bottom: .4em; }
h2 { font-size: 1.32em; margin: 2.2em 0 .7em; padding-bottom: .3em;
     border-bottom: 1px solid var(--rule); }
h3 { font-size: 1.1em; margin: 1.8em 0 .5em; color: var(--accent); }
p, li { margin: .6em 0; }
strong { font-weight: 650; }
blockquote { margin: 1.2em 0; padding: .8em 1.2em; border-left: 4px solid var(--accent);
             background: #f4f8fc; color: #2a3a4a; }
blockquote p { margin: .3em 0; }
table { border-collapse: collapse; width: 100%; margin: 1.2em 0; font-size: .93em; }
th, td { border: 1px solid var(--rule); padding: 8px 11px; text-align: left;
         vertical-align: top; }
th { background: #eef2f7; font-weight: 650; }
tr:nth-child(even) td { background: #fafbfc; }
code { background: var(--code-bg); padding: .12em .38em; border-radius: 3px;
       font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
       font-size: .88em; }
pre { background: var(--code-bg); border: 1px solid var(--rule); border-radius: 5px;
      padding: 14px 16px; overflow-x: auto; line-height: 1.55; }
pre code { background: none; padding: 0; font-size: .85em; }
hr { border: none; border-top: 1px solid var(--rule); margin: 2.4em 0; }
a { color: var(--accent); }
.fig-wrap { margin: 1.8em 0; padding: 14px; border: 1px solid var(--rule);
            border-radius: 6px; background: var(--bg); }
.fig-wrap svg { display: block; width: 100%; height: auto; }
.meta { color: var(--muted); font-size: .88em; margin-top: 3.5em;
        border-top: 1px solid var(--rule); padding-top: 1em; }
@media print {
  body { max-width: none; padding: 0; font-size: 11pt; }
  h2 { page-break-after: avoid; }
  table, pre, blockquote, .fig-wrap { page-break-inside: avoid; }
  .meta { display: none; }
}
"""

TEMPLATE = """<!DOCTYPE html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<style>{css}</style>
</head>
<body>
{body}
<div class="meta">Generated from {source} on {ts} &middot; single file, readable offline &middot; press Cmd-P to export PDF</div>
</body>
</html>
"""


def inline_svgs(html: str, base: Path) -> str:
    """Replace <img src="*.svg"> with the SVG itself.

    The report is emailed and printed as one file, so external image
    references would arrive broken. Inlining also lets the figures inherit
    the page's light/dark theme and keeps their <title> hover tooltips.
    """
    def repl(m):
        src = m.group(1)
        f = (base / src).resolve()
        if not f.exists() or f.suffix != ".svg":
            return m.group(0)
        svg = f.read_text(encoding="utf-8")
        svg = re.sub(r"<\?xml[^>]*\?>", "", svg).strip()
        return f'<figure class="fig-wrap">{svg}</figure>'
    html = re.sub(r'<p>\s*<img[^>]*src="([^"]+\.svg)"[^>]*/?>\s*</p>', repl, html)
    return re.sub(r'<img[^>]*src="([^"]+\.svg)"[^>]*/?>', repl, html)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("source")
    ap.add_argument("-o", "--out")
    ap.add_argument("--title")
    ap.add_argument("--lang", default="zh-CN")
    args = ap.parse_args()

    src = Path(args.source)
    text = src.read_text(encoding="utf-8")

    raw_body = markdown.markdown(
        text,
        extensions=["tables", "fenced_code", "toc", "sane_lists", "attr_list"],
        output_format="html5",
    )
    body = inline_svgs(raw_body, src.resolve().parent)

    title = args.title
    if not title:
        first = next((l for l in text.splitlines() if l.startswith("# ")), None)
        title = first[2:].strip() if first else src.stem

    out = Path(args.out) if args.out else src.with_suffix(".html")
    out.write_text(
        TEMPLATE.format(
            lang=args.lang, title=title, css=CSS, body=body,
            source=src.name,
            ts=_dt.datetime.now().strftime("%Y-%m-%d %H:%M"),
        ),
        encoding="utf-8",
    )
    print(f"{out}  ({out.stat().st_size/1024:.0f} KB)")


if __name__ == "__main__":
    main()

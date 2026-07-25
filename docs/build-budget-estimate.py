#!/usr/bin/env python3
"""
Generate the "budget estimate — how the math works" PDF.

Rendered in the Indigo Iota brand system (see frontend/docs/build-style-guide.py):
cream canvas, indigo accent, Albert Sans for UI, Instrument Serif italic for the
'iota' in the wordmark, Albert Sans for every figure. Same fonts, colors,
wordmark, and page-header pattern as the brand guide.
"""

import os
import textwrap
import urllib.request

from reportlab.lib.colors import Color, HexColor
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

PAGE_W, PAGE_H = A4
MARGIN = 50
CONTENT_W = PAGE_W - MARGIN * 2

# --- Colors (exact match to globals.css / brand guide) ---------------------
CREAM = HexColor("#f0f0ec")
WHITE = HexColor("#ffffff")
INDIGO = HexColor("#3812f3")
INDIGO_SOFT = HexColor("#7159f6")
BLACK = HexColor("#0f0f0f")
MUTED = HexColor("#616161")
SUBTLE = HexColor("#8c8c8c")
BORDER = HexColor("#d0cfc8")
BORDER_STRONG = HexColor("#b4b3a9")
WARNING = HexColor("#cf7f10")
INDIGO_TINT = Color(0.22, 0.07, 0.95, 0.06)   # very light indigo wash
WARN_TINT = Color(0.81, 0.50, 0.06, 0.10)

# --- Fonts -----------------------------------------------------------------
FONTS_DIR = "/tmp/iota_fonts"
os.makedirs(FONTS_DIR, exist_ok=True)
FONT_FILES = [
    ("AlbertSans-Regular",
     "https://cdn.jsdelivr.net/fontsource/fonts/albert-sans@latest/latin-400-normal.ttf"),
    ("AlbertSans-Medium",
     "https://cdn.jsdelivr.net/fontsource/fonts/albert-sans@latest/latin-500-normal.ttf"),
    ("AlbertSans-Bold",
     "https://cdn.jsdelivr.net/fontsource/fonts/albert-sans@latest/latin-700-normal.ttf"),
    ("AlbertSans-ExtraBold",
     "https://cdn.jsdelivr.net/fontsource/fonts/albert-sans@latest/latin-800-normal.ttf"),
    ("InstrumentSerif-Italic",
     "https://cdn.jsdelivr.net/fontsource/fonts/instrument-serif@latest/latin-400-italic.ttf"),
]
for name, url in FONT_FILES:
    target = f"{FONTS_DIR}/{name}.ttf"
    if not os.path.exists(target):
        print(f"Downloading {name}")
        urllib.request.urlretrieve(url, target)
    pdfmetrics.registerFont(TTFont(name, target))


# --- Primitives ------------------------------------------------------------

def fill_page(c, color):
    c.setFillColor(color)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)


def text(c, x, y, s, font="AlbertSans-Regular", size=10, color=BLACK):
    c.setFont(font, size)
    c.setFillColor(color)
    c.drawString(x, y, s)


def text_right(c, x, y, s, font="AlbertSans-Regular", size=10, color=BLACK):
    c.setFont(font, size)
    c.setFillColor(color)
    c.drawRightString(x, y, s)


def wordmark(c, x, y, size=32, color=INDIGO):
    c.setFillColor(color)
    c.setFont("AlbertSans-ExtraBold", size)
    indigo_w = c.stringWidth("indigo", "AlbertSans-ExtraBold", size)
    c.drawString(x, y, "indigo")
    c.setFont("InstrumentSerif-Italic", size)
    c.drawString(x + indigo_w + size * 0.04, y, "iota")


def page_header(c, label, page_num):
    text(c, MARGIN, PAGE_H - 30, "Indigo Iota / budget model",
         font="AlbertSans-Regular", size=8, color=SUBTLE)
    text_right(c, PAGE_W - MARGIN, PAGE_H - 30, f"{page_num:02d}",
               font="AlbertSans-Regular", size=8, color=SUBTLE)
    text(c, MARGIN, PAGE_H - 56, label.upper(),
         font="AlbertSans-Regular", size=10, color=INDIGO)
    c.setStrokeColor(BORDER)
    c.setLineWidth(0.5)
    c.line(MARGIN, PAGE_H - 64, PAGE_W - MARGIN, PAGE_H - 64)


def section(c, y, num, title):
    text(c, MARGIN, y, num, font="AlbertSans-Regular", size=10, color=INDIGO)
    text(c, MARGIN + 34, y, title, font="AlbertSans-Bold", size=14, color=BLACK)
    return y - 22


def wrapped(c, x, y, s, width_chars, font="AlbertSans-Regular", size=10,
            color=MUTED, leading=14):
    for line in textwrap.wrap(s, width=width_chars):
        text(c, x, y, line, font=font, size=size, color=color)
        y -= leading
    return y


def card(c, x, top_y, w, h, fill=WHITE, border=BORDER):
    c.setFillColor(fill)
    if border is not None:
        c.setStrokeColor(border)
        c.setLineWidth(0.6)
        c.roundRect(x, top_y - h, w, h, 6, fill=1, stroke=1)
    else:
        c.roundRect(x, top_y - h, w, h, 6, fill=1, stroke=0)


def table(c, top_y, columns, header, rows, row_h=19, pad=12):
    """Render a white-card table on the cream canvas.

    columns: list of dicts {w, align('l'/'r'/'c'), font, color}
    header:  list of header strings (Albert Sans Medium, black)
    rows:    list of row tuples (strings)
    Returns the y just below the card.
    """
    n = len(rows)
    header_h = 24
    h = pad + header_h + n * row_h + pad - 6
    card(c, MARGIN, top_y, CONTENT_W, h)

    # column left edges
    xs = []
    cx = MARGIN + pad
    for col in columns:
        xs.append(cx)
        cx += col["w"]

    def cell(x, y, s, col, font_override=None, color_override=None):
        font = font_override or col["font"]
        color = color_override or col.get("color", BLACK)
        if col["align"] == "r":
            text_right(c, x + col["w"] - pad, y, s, font=font,
                       size=col.get("size", 9.5), color=color)
        elif col["align"] == "c":
            c.setFont(font, col.get("size", 9.5))
            c.setFillColor(color)
            tw = c.stringWidth(s, font, col.get("size", 9.5))
            c.drawString(x + (col["w"] - tw) / 2, y, s)
        else:
            text(c, x, y, s, font=font, size=col.get("size", 9.5), color=color)

    # header
    hy = top_y - pad - 8
    for x, col, label in zip(xs, columns, header):
        cell(x, hy, label, col, font_override="AlbertSans-Medium",
             color_override=BLACK)
    c.setStrokeColor(BORDER)
    c.setLineWidth(0.5)
    c.line(MARGIN + pad, hy - 6, MARGIN + CONTENT_W - pad, hy - 6)

    # rows
    ry = hy - 6 - row_h + 5
    for row in rows:
        for x, col, val in zip(xs, columns, row):
            cell(x, ry, val, col)
        ry -= row_h
    return top_y - h


# --- Pages -----------------------------------------------------------------

def page_one(c):
    fill_page(c, CREAM)
    page_header(c, "Budget estimate", 1)

    y = PAGE_H - 100
    text(c, MARGIN, y, "How the budget estimate works",
         font="AlbertSans-Bold", size=22, color=BLACK)
    y -= 26
    y = wrapped(c, MARGIN, y,
                "What a dollar budget buys, derived from the real extraction "
                "pipeline — not a single model pass. Customer figures are US "
                "dollars (1 credit = $1). Every figure is approximate and tunable.",
                92, size=10.5, leading=15)
    y -= 14

    # 01 — price
    y = section(c, y, "01", "The price we assume")
    y = wrapped(c, MARGIN, y,
                "Everything traces back to the cheapest model in our price book. "
                "Its per-million-token rates are the single underlying assumption.",
                92)
    y -= 8
    cols = [
        {"w": 150, "align": "l", "font": "AlbertSans-Regular", "color": MUTED},
        {"w": CONTENT_W - 24 - 150, "align": "l", "font": "AlbertSans-Regular",
         "color": BLACK},
    ]
    y = table(c, y, cols,
              ["Item", "Value"],
              [
                  ("Basis model", "openai/gpt-oss-120b"),
                  ("Input price", "$0.09 / 1,000,000 tokens"),
                  ("Output price", "$0.36 / 1,000,000 tokens"),
                  ("Customer markup", "x10  ->  customer $ (1 credit = $1)"),
              ])
    y -= 26

    # 02 — fan-out
    y = section(c, y, "02", "Filling the brain fans out")
    y = wrapped(c, MARGIN, y,
                "Each item runs the extraction pipeline. One agent finds the "
                "entities, then four agents run PER ENTITY — and every one re-reads "
                "the full item text. The body is sent to the model many times over.",
                94)
    y -= 8
    cols = [
        {"w": 250, "align": "l", "font": "AlbertSans-Regular", "color": BLACK},
        {"w": 120, "align": "l", "font": "AlbertSans-Regular", "color": INDIGO},
        {"w": CONTENT_W - 24 - 250 - 120, "align": "l",
         "font": "AlbertSans-Regular", "color": MUTED, "size": 9},
    ]
    y = table(c, y, cols,
              ["Pipeline step", "LLM calls", "Reads"],
              [
                  ("Identifier — find entities", "1 / item", "full item"),
                  ("Frontmatter — per entity", "1 x N", "full item"),
                  ("Judgment — relationship / status", "1 x N", "full item"),
                  ("Description — write / update", "1 x N", "full item + page"),
                  ("Timeline — per entity", "1 x N", "full item"),
                  ("Canonicalize / embed / graph", "0  local", "free"),
              ])
    y -= 18
    text(c, MARGIN, y, "Total LLM calls per item",
         font="AlbertSans-Medium", size=10.5, color=BLACK)
    text(c, MARGIN + 170, y, "= 1 + 4 x (entities found)",
         font="AlbertSans-Bold", size=10.5, color=INDIGO)
    y -= 16
    wrapped(c, MARGIN, y,
            "Because the body is resent every call, input tokens are roughly "
            "body x calls. The fan-out, not the body size, dominates cost.",
            96, size=9.5)

    # footer wordmark
    wordmark(c, MARGIN, 48, size=12, color=INDIGO)
    text_right(c, PAGE_W - MARGIN, 48, "internal reference · 2026",
               font="AlbertSans-Regular", size=8, color=SUBTLE)
    c.showPage()


def page_two(c):
    fill_page(c, CREAM)
    page_header(c, "Budget estimate", 2)

    y = PAGE_H - 100

    # 03 — assumptions
    y = section(c, y, "03", "Per-item assumptions (tunable)")
    cols = [
        {"w": 150, "align": "l", "font": "AlbertSans-Medium", "color": BLACK},
        {"w": 115, "align": "r", "font": "AlbertSans-Regular", "color": BLACK},
        {"w": 115, "align": "r", "font": "AlbertSans-Regular", "color": BLACK},
        {"w": CONTENT_W - 24 - 150 - 115 - 115, "align": "r",
         "font": "AlbertSans-Regular", "color": INDIGO},
    ]
    y = table(c, y, cols,
              ["", "Body tokens", "Entities / item", "Calls = 1+4N"],
              [
                  ("1 email", "2,000", "4", "17"),
                  ("1 document", "12,000", "8", "33"),
              ])
    y -= 24

    # 04 — worked cost
    y = section(c, y, "04", "Worked cost per item")
    card(c, MARGIN, y + 4, CONTENT_W, 40, fill=INDIGO_TINT, border=None)
    text(c, MARGIN + 14, y - 8,
         "input = body x calls    output = 180 x calls",
         font="AlbertSans-Regular", size=9.5, color=BLACK)
    text(c, MARGIN + 14, y - 24,
         "our cost = input/1e6 x 0.09 + output/1e6 x 0.36    price = cost x 10",
         font="AlbertSans-Regular", size=9.5, color=BLACK)
    y -= 52
    cols = [
        {"w": 130, "align": "l", "font": "AlbertSans-Medium", "color": BLACK},
        {"w": 95, "align": "r", "font": "AlbertSans-Regular", "color": BLACK},
        {"w": 95, "align": "r", "font": "AlbertSans-Regular", "color": BLACK},
        {"w": 90, "align": "r", "font": "AlbertSans-Regular", "color": MUTED},
        {"w": CONTENT_W - 24 - 130 - 95 - 95 - 90, "align": "r",
         "font": "AlbertSans-Bold", "color": INDIGO},
    ]
    y = table(c, y, cols,
              ["", "Input tok", "Output tok", "Our cost", "Price"],
              [
                  ("1 email", "34,000", "3,060", "$0.00416", "$0.0416"),
                  ("1 document", "396,000", "5,940", "$0.03778", "$0.3778"),
              ])
    y -= 26

    # 05 — capacity
    y = section(c, y, "05", "Turning a budget into capacity")
    y = wrapped(c, MARGIN, y,
                "capacity = budget / price-per-item, both in dollars. The x10 markup "
                "is in numerator and denominator, so it cancels.", 94)
    y -= 6
    card(c, MARGIN, y + 2, CONTENT_W, 52, fill=WHITE, border=BORDER)
    text(c, MARGIN + 16, y - 14, "$100 of remaining budget",
         font="AlbertSans-Medium", size=10, color=BLACK)
    text(c, MARGIN + 16, y - 34, "~ 2,402 emails",
         font="AlbertSans-Bold", size=12, color=INDIGO)
    text(c, MARGIN + 230, y - 34, "~ 264 documents",
         font="AlbertSans-Bold", size=12, color=INDIGO)
    y -= 70

    # correction callout
    callout_h = 70
    card(c, MARGIN, y, CONTENT_W, callout_h, fill=WARN_TINT, border=None)
    c.setFillColor(WARNING)
    c.rect(MARGIN, y - callout_h, 3, callout_h, fill=1, stroke=0)
    text(c, MARGIN + 16, y - 20, "Why this is far lower than a naive estimate",
         font="AlbertSans-Bold", size=10.5, color=BLACK)
    wrapped(c, MARGIN + 16, y - 36,
            "A single-pass guess gave ~18,500 emails per $100. Modelling the real 17 "
            "calls/email — each re-reading the body — gives ~2,400: roughly 8x the "
            "cost for email, ~12x for documents.",
            88, size=9, leading=12)
    y -= callout_h + 24

    # caveats
    text(c, MARGIN, y, "Caveats", font="AlbertSans-Bold", size=12, color=BLACK)
    y -= 18
    caveats = [
        "The big lever is entities-per-item (4 / email, 8 / doc) and body size — "
        "estimates, not yet measured against the pilot's real corpus.",
        "Output is approximated at 180 tokens/call; input fan-out dominates, so it "
        "barely moves the total.",
        "Basis is the cheapest model; pricier routing is absorbed by the x10 markup.",
        "Embeddings (local fastembed) and canonicalization (deterministic) are free.",
        "Live billing meters every real call, so actual spend tracks this as the "
        "corpus is ingested.",
    ]
    for ca in caveats:
        c.setFillColor(INDIGO)
        c.circle(MARGIN + 3, y + 3, 1.5, fill=1, stroke=0)
        yy = wrapped(c, MARGIN + 14, y, ca, 96, size=9, leading=12)
        y = yy - 4

    text(c, MARGIN, 60,
         "Source: src/billing/metering.py  (_pipeline_tokens, customer_cost_per_item)",
         font="AlbertSans-Regular", size=8, color=SUBTLE)
    wordmark(c, MARGIN, 40, size=12, color=INDIGO)
    text_right(c, PAGE_W - MARGIN, 40, "indigo-iota.com",
               font="AlbertSans-Regular", size=8, color=SUBTLE)
    c.showPage()


def main():
    out_dir = "/Users/juliuskasiske/Documents/indigo_iota/client-demo-v1/docs"
    os.makedirs(out_dir, exist_ok=True)
    output = f"{out_dir}/budget-estimate-math.pdf"

    c = canvas.Canvas(output, pagesize=A4)
    c.setTitle("Indigo Iota — budget estimate math")
    c.setAuthor("Indigo Iota")
    c.setSubject("How the credit-budget capacity estimate is derived")
    page_one(c)
    page_two(c)
    c.save()
    print(f"Wrote: {output}")


if __name__ == "__main__":
    main()

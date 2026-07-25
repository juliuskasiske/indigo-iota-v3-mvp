#!/usr/bin/env python3
"""
Generate the Indigo Iota brand style guide PDF.

A4, multi-page, with the actual brand fonts downloaded from the Google Fonts
GitHub mirror and registered with ReportLab so the document is a true
specimen of the type system.
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

# --- Colors (exact match to globals.css) -----------------------------------
CREAM = HexColor("#f0f0ec")
WHITE = HexColor("#ffffff")
SOFT = HexColor("#e4e3db")
INDIGO = HexColor("#3812f3")
INDIGO_SOFT = HexColor("#7159f6")
BLACK = HexColor("#0f0f0f")
MUTED = HexColor("#616161")
SUBTLE = HexColor("#8c8c8c")
BORDER = HexColor("#d0cfc8")
BORDER_STRONG = HexColor("#b4b3a9")
SUCCESS = HexColor("#1c8a52")
WARNING = HexColor("#cf7f10")
DESTRUCT = HexColor("#cd2929")

# --- Fonts -----------------------------------------------------------------
FONTS_DIR = "/tmp/iota_fonts"
os.makedirs(FONTS_DIR, exist_ok=True)

# Static font files from the Fontsource CDN — covers each weight we need.
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
    ("InstrumentSerif",
     "https://cdn.jsdelivr.net/fontsource/fonts/instrument-serif@latest/latin-400-normal.ttf"),
]

for name, url in FONT_FILES:
    target = f"{FONTS_DIR}/{name}.ttf"
    if not os.path.exists(target):
        print(f"Downloading {name}")
        urllib.request.urlretrieve(url, target)
    pdfmetrics.registerFont(TTFont(name, target))


# --- Drawing helpers -------------------------------------------------------

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
    """Render the indigo iota wordmark at (x, y), with y on baseline."""
    indigo_font = "AlbertSans-ExtraBold"
    iota_font = "InstrumentSerif-Italic"
    c.setFillColor(color)
    c.setFont(indigo_font, size)
    indigo_w = c.stringWidth("indigo", indigo_font, size)
    c.drawString(x, y, "indigo")
    c.setFont(iota_font, size)
    c.drawString(x + indigo_w + size * 0.04, y, "iota")


def wordmark_width(c, size=32):
    indigo_w = c.stringWidth("indigo", "AlbertSans-ExtraBold", size)
    iota_w = c.stringWidth("iota", "InstrumentSerif-Italic", size)
    return indigo_w + size * 0.04 + iota_w


def page_header(c, label, page_num):
    text(c, MARGIN, PAGE_H - 30, "Indigo Iota / brand style guide",
         font="AlbertSans-Regular", size=8, color=SUBTLE)
    text_right(c, PAGE_W - MARGIN, PAGE_H - 30, f"{page_num:02d}",
               font="AlbertSans-Regular", size=8, color=SUBTLE)
    # Section label
    text(c, MARGIN, PAGE_H - 56, label.upper(),
         font="AlbertSans-Regular", size=10, color=INDIGO)
    # Hairline under the header
    c.setStrokeColor(BORDER)
    c.setLineWidth(0.5)
    c.line(MARGIN, PAGE_H - 64, PAGE_W - MARGIN, PAGE_H - 64)


def draw_check(c, x, y, size=10, color=None):
    """Draw a checkmark using strokes (Latin font subset lacks ✓)."""
    if color is None:
        color = SUCCESS
    c.setStrokeColor(color)
    c.setLineWidth(1.7)
    c.setLineCap(1)
    p = c.beginPath()
    p.moveTo(x + size * 0.14, y + size * 0.50)
    p.lineTo(x + size * 0.40, y + size * 0.22)
    p.lineTo(x + size * 0.86, y + size * 0.78)
    c.drawPath(p, stroke=1, fill=0)


def draw_cross(c, x, y, size=10, color=None):
    """Draw an X using strokes (Latin font subset lacks ✗)."""
    if color is None:
        color = DESTRUCT
    c.setStrokeColor(color)
    c.setLineWidth(1.7)
    c.setLineCap(1)
    c.line(x + size * 0.20, y + size * 0.20, x + size * 0.80, y + size * 0.80)
    c.line(x + size * 0.20, y + size * 0.80, x + size * 0.80, y + size * 0.20)


def draw_arrow(c, x, y, size=10, color=None):
    """Draw a right-pointing arrow."""
    if color is None:
        color = INDIGO
    c.setStrokeColor(color)
    c.setFillColor(color)
    c.setLineWidth(1.5)
    c.setLineCap(1)
    # shaft
    c.line(x, y + size * 0.5, x + size * 0.75, y + size * 0.5)
    # head — small filled triangle
    p = c.beginPath()
    p.moveTo(x + size * 0.75, y + size * 0.25)
    p.lineTo(x + size, y + size * 0.5)
    p.lineTo(x + size * 0.75, y + size * 0.75)
    p.close()
    c.drawPath(p, fill=1, stroke=0)


def draw_wrapped(c, x, y, text_str, max_width_chars, font, size, color, line_height=None):
    """Cheap word-wrap. Returns final y."""
    if line_height is None:
        line_height = size * 1.4
    wrapped = textwrap.wrap(text_str, width=max_width_chars)
    for line in wrapped:
        text(c, x, y, line, font=font, size=size, color=color)
        y -= line_height
    return y


# --- Pages -----------------------------------------------------------------

def page_cover(c):
    fill_page(c, CREAM)

    # Tiny mark-of-quality strip at the top
    text(c, MARGIN, PAGE_H - 60, "01 / 08",
         font="AlbertSans-Regular", size=9, color=SUBTLE)
    text(c, MARGIN, PAGE_H - 80, "BRAND STYLE GUIDE",
         font="AlbertSans-Regular", size=10, color=INDIGO)

    # Centerpiece wordmark — big
    wordmark_size = 96
    y_wordmark = PAGE_H / 2 + 40
    wordmark(c, MARGIN, y_wordmark, size=wordmark_size, color=INDIGO)

    # Subtitle in regular Albert Sans
    c.setFillColor(BLACK)
    c.setFont("AlbertSans-Regular", 18)
    c.drawString(MARGIN, y_wordmark - 50,
                 "the project brain for consultancies")

    # Description paragraph
    c.setFillColor(MUTED)
    c.setFont("AlbertSans-Regular", 12)
    intro = ("This document defines the visual identity of Indigo Iota — "
             "the wordmark, color, typography, and component usage that "
             "every surface of the product, the website, and our outbound "
             "should be measured against.")
    y = y_wordmark - 90
    for line in textwrap.wrap(intro, width=70):
        c.drawString(MARGIN, y, line)
        y -= 16

    # Footer
    c.setFont("AlbertSans-Regular", 9)
    c.setFillColor(SUBTLE)
    c.drawString(MARGIN, 60, "v1 · 2026")
    text_right(c, PAGE_W - MARGIN, 60, "indigo-iota.com",
               font="AlbertSans-Regular", size=9, color=SUBTLE)

    c.showPage()


def page_logo(c):
    fill_page(c, CREAM)
    page_header(c, "Logo / wordmark", 2)

    # Hero wordmark
    wordmark(c, MARGIN, PAGE_H - 180, size=76, color=INDIGO)

    # Anatomy callouts (right side)
    c.setFillColor(MUTED)
    c.setFont("AlbertSans-Regular", 8)
    c.drawString(MARGIN + 420, PAGE_H - 165,
                 "Albert Sans · ExtraBold · -0.03em tracking")
    c.drawString(MARGIN + 420, PAGE_H - 178,
                 "Instrument Serif · Italic 400")
    c.drawString(MARGIN + 420, PAGE_H - 191, "Color: #3812F3")

    # Construction section
    y = PAGE_H - 280
    text(c, MARGIN, y, "Construction",
         font="AlbertSans-Bold", size=16, color=BLACK)
    y -= 24
    items = [
        ('"indigo"', 'Albert Sans · ExtraBold · tight tracking (-0.03em).'),
        ('"iota"',   'Instrument Serif · Italic · 400 · placed to the right with a small gap (~0.04em).'),
        ("Color",    'Indigo #3812F3 by default. Black #0F0F0F is the only other approved foreground.'),
        ("Casing",   'Always lowercase. "INDIGO IOTA" or "Indigo Iota" are incorrect.'),
        ("Min size", '16px / 5mm equivalent — below this the iota italic loses crispness.'),
    ]
    for label, value in items:
        text(c, MARGIN, y, label, font="AlbertSans-Medium", size=11, color=BLACK)
        # split value into wrap lines starting at column 110
        wrapped = textwrap.wrap(value, width=72)
        first = True
        for line in wrapped:
            text(c, MARGIN + 110 if first else MARGIN + 110, y, line,
                 font="AlbertSans-Regular", size=11, color=MUTED)
            y -= 16
            first = False
        y -= 4

    # Approved color treatments
    y -= 16
    text(c, MARGIN, y, "Approved color treatments",
         font="AlbertSans-Bold", size=16, color=BLACK)
    y -= 8

    sw_h = 70
    sw_w = (PAGE_W - MARGIN * 2 - 20) / 3
    swatch_y = y - sw_h - 20

    # 1. Indigo on cream
    c.setFillColor(CREAM)
    c.setStrokeColor(BORDER)
    c.setLineWidth(0.5)
    c.rect(MARGIN, swatch_y, sw_w, sw_h, fill=1, stroke=1)
    wordmark(c, MARGIN + 14, swatch_y + 28, size=24, color=INDIGO)
    text(c, MARGIN + 14, swatch_y - 14, "Indigo on cream — default",
         font="AlbertSans-Regular", size=8, color=MUTED)

    # 2. Cream on indigo
    c.setFillColor(INDIGO)
    c.rect(MARGIN + sw_w + 10, swatch_y, sw_w, sw_h, fill=1, stroke=0)
    wordmark(c, MARGIN + sw_w + 10 + 14, swatch_y + 28, size=24, color=CREAM)
    text(c, MARGIN + sw_w + 10 + 14, swatch_y - 14,
         "Cream on indigo — inverted / hero",
         font="AlbertSans-Regular", size=8, color=MUTED)

    # 3. White on black
    c.setFillColor(BLACK)
    c.rect(MARGIN + (sw_w + 10) * 2, swatch_y, sw_w, sw_h, fill=1, stroke=0)
    wordmark(c, MARGIN + (sw_w + 10) * 2 + 14, swatch_y + 28,
             size=24, color=WHITE)
    text(c, MARGIN + (sw_w + 10) * 2 + 14, swatch_y - 14,
         "White on black — last resort",
         font="AlbertSans-Regular", size=8, color=MUTED)

    c.showPage()


def page_colors(c):
    fill_page(c, CREAM)
    page_header(c, "Color", 3)

    y = PAGE_H - 100
    text(c, MARGIN, y, "Two-color system",
         font="AlbertSans-Bold", size=22, color=BLACK)
    y -= 30
    intro = ("Almost every surface in the product is built from two colors: "
             "cream as the canvas and indigo as the single accent. Black is "
             "the only foreground we add. Everything else (greys, borders) "
             "is a tint of these.")
    for line in textwrap.wrap(intro, width=82):
        text(c, MARGIN, y, line, font="AlbertSans-Regular", size=11, color=MUTED)
        y -= 16
    y -= 18

    # ===== Primary swatches =====
    swatch_h = 140
    swatch_w = (PAGE_W - MARGIN * 2 - 16) / 2

    # Cream
    c.setFillColor(CREAM)
    c.setStrokeColor(BORDER)
    c.setLineWidth(0.5)
    c.rect(MARGIN, y - swatch_h, swatch_w, swatch_h, fill=1, stroke=1)
    text(c, MARGIN + 18, y - 30, "Cream",
         font="AlbertSans-Bold", size=22, color=BLACK)
    text(c, MARGIN + 18, y - 55, "#F0F0EC",
         font="AlbertSans-Regular", size=13, color=BLACK)
    text(c, MARGIN + 18, y - 75, "RGB 240 240 236",
         font="AlbertSans-Regular", size=9, color=MUTED)
    text(c, MARGIN + 18, y - 90, "HSL 60° 14% 93%",
         font="AlbertSans-Regular", size=9, color=MUTED)
    text(c, MARGIN + 18, y - swatch_h + 18,
         "Backgrounds · surfaces · primary canvas",
         font="AlbertSans-Regular", size=10, color=MUTED)

    # Indigo
    indigo_x = MARGIN + swatch_w + 16
    c.setFillColor(INDIGO)
    c.rect(indigo_x, y - swatch_h, swatch_w, swatch_h, fill=1, stroke=0)
    text(c, indigo_x + 18, y - 30, "Indigo",
         font="AlbertSans-Bold", size=22, color=CREAM)
    text(c, indigo_x + 18, y - 55, "#3812F3",
         font="AlbertSans-Regular", size=13, color=CREAM)
    cream_60 = Color(0.94, 0.94, 0.92, 0.7)
    text(c, indigo_x + 18, y - 75, "RGB 56 18 243",
         font="AlbertSans-Regular", size=9, color=cream_60)
    text(c, indigo_x + 18, y - 90, "HSL 250° 88% 51%",
         font="AlbertSans-Regular", size=9, color=cream_60)
    text(c, indigo_x + 18, y - swatch_h + 18,
         "Brand · CTAs · links · focus rings",
         font="AlbertSans-Regular", size=10, color=CREAM)

    y -= swatch_h + 30

    # ===== Supporting greyscale & soft indigo =====
    text(c, MARGIN, y, "Foreground & supporting",
         font="AlbertSans-Bold", size=14, color=BLACK)
    y -= 24

    supporting = [
        ("Black",        "#0F0F0F", "Body text",        BLACK,        CREAM, False),
        ("Muted",        "#616161", "Secondary text",   MUTED,        CREAM, False),
        ("Subtle",       "#8C8C8C", "Hints, labels",    SUBTLE,       CREAM, False),
        ("Border",       "#D0CFC8", "Dividers, cards",  BORDER,       BLACK, True),
        ("Indigo soft",  "#7159F6", "Gradients, hover", INDIGO_SOFT,  CREAM, False),
        ("White",        "#FFFFFF", "Elevated cards",   WHITE,        BLACK, True),
    ]
    sw_w = 78
    sw_h = 70
    gap = 10
    x = MARGIN
    for name, hex_code, usage, color, fg, has_border in supporting:
        c.setFillColor(color)
        if has_border:
            c.setStrokeColor(BORDER_STRONG)
            c.setLineWidth(0.5)
            c.rect(x, y - sw_h, sw_w, sw_h, fill=1, stroke=1)
        else:
            c.rect(x, y - sw_h, sw_w, sw_h, fill=1, stroke=0)
        text(c, x + 8, y - 18, name,
             font="AlbertSans-Medium", size=10, color=fg)
        text(c, x + 8, y - 32, hex_code,
             font="AlbertSans-Regular", size=8, color=fg)
        text(c, x + 8, y - sw_h - 12, usage,
             font="AlbertSans-Regular", size=8, color=MUTED)
        x += sw_w + gap

    y -= sw_h + 50

    # Semantic
    text(c, MARGIN, y, "Semantic",
         font="AlbertSans-Bold", size=14, color=BLACK)
    y -= 24
    semantic = [
        ("Success",     "#1C8A52", SUCCESS),
        ("Warning",     "#CF7F10", WARNING),
        ("Destructive", "#CD2929", DESTRUCT),
    ]
    sem_w = 100
    x = MARGIN
    for name, hex_code, color in semantic:
        c.setFillColor(color)
        c.rect(x, y - sw_h, sem_w, sw_h, fill=1, stroke=0)
        text(c, x + 10, y - 20, name,
             font="AlbertSans-Medium", size=11, color=WHITE)
        text(c, x + 10, y - 36, hex_code,
             font="AlbertSans-Regular", size=9, color=WHITE)
        x += sem_w + gap
    text(c, MARGIN, y - sw_h - 14,
         "Used sparingly — for status badges, alerts, and validation. Never decorative.",
         font="AlbertSans-Regular", size=9, color=MUTED)

    c.showPage()


def page_typography(c):
    fill_page(c, CREAM)
    page_header(c, "Typography", 4)

    y = PAGE_H - 100
    text(c, MARGIN, y, "Typography",
         font="AlbertSans-Bold", size=22, color=BLACK)
    y -= 28
    intro = "Two families. Albert Sans does all the UI work, including the technical chrome (counters, IDs, labels). Instrument Serif is reserved for the iota italic in the wordmark."
    for line in textwrap.wrap(intro, width=85):
        text(c, MARGIN, y, line, font="AlbertSans-Regular", size=10, color=MUTED)
        y -= 14
    y -= 16

    # ===== Albert Sans =====
    text(c, MARGIN, y, "Albert Sans",
         font="AlbertSans-Bold", size=20, color=BLACK)
    text(c, MARGIN + 230, y, "System & body",
         font="AlbertSans-Regular", size=10, color=INDIGO)
    y -= 30

    text(c, MARGIN, y, "Aa Bb Cc 123 ?!",
         font="AlbertSans-Regular", size=32, color=BLACK)
    y -= 42

    weights = [
        ("Regular 400",   "AlbertSans-Regular"),
        ("Medium 500",    "AlbertSans-Medium"),
        ("Bold 700",      "AlbertSans-Bold"),
        ("ExtraBold 800", "AlbertSans-ExtraBold"),
    ]
    for label, font in weights:
        text(c, MARGIN, y, label,
             font="AlbertSans-Regular", size=9, color=SUBTLE)
        text(c, MARGIN + 110, y,
             "The project brain for consultancies.",
             font=font, size=14, color=BLACK)
        y -= 22

    y -= 6
    text(c, MARGIN, y, "Use for",
         font="AlbertSans-Medium", size=10, color=BLACK)
    text(c, MARGIN + 70, y,
         "All UI text — body, headings, labels, buttons, navigation.",
         font="AlbertSans-Regular", size=10, color=MUTED)

    # ===== Instrument Serif =====
    y -= 50
    text(c, MARGIN, y, "Instrument Serif",
         font="AlbertSans-Bold", size=20, color=BLACK)
    text(c, MARGIN + 230, y, "Display italic",
         font="AlbertSans-Regular", size=10, color=INDIGO)
    y -= 30

    c.setFont("InstrumentSerif-Italic", 32)
    c.setFillColor(BLACK)
    c.drawString(MARGIN, y, "Aa Bb Cc 123 ?!")
    y -= 36

    text(c, MARGIN, y, "Italic 400",
         font="AlbertSans-Regular", size=9, color=SUBTLE)
    c.setFont("InstrumentSerif-Italic", 14)
    c.setFillColor(BLACK)
    c.drawString(MARGIN + 110, y,
                 "iota — the brain that keeps your team in sync.")
    y -= 28

    text(c, MARGIN, y, "Use for",
         font="AlbertSans-Medium", size=10, color=BLACK)
    wrapped = textwrap.wrap(
        "The 'iota' part of the wordmark only. "
        "Reserved for brand expression — never body copy.",
        width=80,
    )
    first = True
    for line in wrapped:
        text(c, MARGIN + 70 if first else MARGIN + 70, y, line,
             font="AlbertSans-Regular", size=10, color=MUTED)
        y -= 14
        first = False

    # ===== Technical chrome (Albert Sans) =====
    y -= 30
    text(c, MARGIN, y, "Technical chrome",
         font="AlbertSans-Bold", size=20, color=BLACK)
    text(c, MARGIN + 230, y, "Albert Sans · uppercase",
         font="AlbertSans-Regular", size=10, color=INDIGO)
    y -= 30

    c.setFont("AlbertSans-Medium", 26)
    c.setFillColor(BLACK)
    c.drawString(MARGIN, y, "Aa Bb Cc 123 ?!")
    y -= 34

    text(c, MARGIN, y, "Medium 500",
         font="AlbertSans-Regular", size=9, color=SUBTLE)
    c.setFont("AlbertSans-Medium", 12)
    c.setFillColor(BLACK)
    c.drawString(MARGIN + 110, y,
                 "WEEK 12 / 12  ·  487 emails  ·  142 files")
    y -= 26

    text(c, MARGIN, y, "Use for",
         font="AlbertSans-Medium", size=10, color=BLACK)
    text(c, MARGIN + 70, y,
         "Counters, IDs, labels and technical chrome — Albert Sans, tracked.",
         font="AlbertSans-Regular", size=10, color=MUTED)

    c.showPage()


def page_scale(c):
    fill_page(c, CREAM)
    page_header(c, "Type scale", 5)

    y = PAGE_H - 100
    text(c, MARGIN, y, "Scale",
         font="AlbertSans-Bold", size=22, color=BLACK)
    y -= 28
    intro = ("Eight steps cover every type need. Pair sizes with the weights "
             "below — never bold a Body to fake a Heading.")
    for line in textwrap.wrap(intro, width=85):
        text(c, MARGIN, y, line, font="AlbertSans-Regular", size=10, color=MUTED)
        y -= 14
    y -= 16

    scale = [
        ("Display",    48, "AlbertSans-Bold"),
        ("Heading 1",  32, "AlbertSans-Bold"),
        ("Heading 2",  24, "AlbertSans-Bold"),
        ("Heading 3",  18, "AlbertSans-Bold"),
        ("Body",       14, "AlbertSans-Regular"),
        ("Body small", 12, "AlbertSans-Regular"),
        ("Label",      10, "AlbertSans-Medium"),
        ("Caption",    9,  "AlbertSans-Regular"),
    ]

    # Shorter demo string for the larger sizes so they don't overflow
    def demo_for(size):
        if size >= 32:
            return "Stay in sync"
        if size >= 18:
            return "The brain that syncs"
        return "The brain that keeps you in sync"

    for label, size, font in scale:
        text(c, MARGIN, y - 4, f"{label} · {size}px",
             font="AlbertSans-Regular", size=9, color=SUBTLE)
        c.setFont(font, size)
        c.setFillColor(BLACK)
        c.drawString(MARGIN + 130, y - size * 0.7, demo_for(size))
        y -= max(34, size + 14)

    # Color usage in text
    y -= 16
    text(c, MARGIN, y, "Color in text",
         font="AlbertSans-Bold", size=14, color=BLACK)
    y -= 22
    text(c, MARGIN, y, "Body & headings", font="AlbertSans-Regular",
         size=9, color=SUBTLE)
    text(c, MARGIN + 130, y, "#0F0F0F", font="AlbertSans-Regular",
         size=11, color=BLACK)
    text(c, MARGIN + 200, y, "near-black",
         font="AlbertSans-Regular", size=11, color=MUTED)
    y -= 18
    text(c, MARGIN, y, "Links / accents", font="AlbertSans-Regular",
         size=9, color=SUBTLE)
    text(c, MARGIN + 130, y, "#3812F3", font="AlbertSans-Regular",
         size=11, color=INDIGO)
    text(c, MARGIN + 200, y, "indigo",
         font="AlbertSans-Regular", size=11, color=MUTED)
    y -= 18
    text(c, MARGIN, y, "Muted copy", font="AlbertSans-Regular",
         size=9, color=SUBTLE)
    text(c, MARGIN + 130, y, "#616161", font="AlbertSans-Regular",
         size=11, color=MUTED)
    text(c, MARGIN + 200, y, "neutral grey",
         font="AlbertSans-Regular", size=11, color=MUTED)

    c.showPage()


def page_components(c):
    fill_page(c, CREAM)
    page_header(c, "Components", 6)

    y = PAGE_H - 100
    text(c, MARGIN, y, "Components",
         font="AlbertSans-Bold", size=22, color=BLACK)
    y -= 38

    # ===== Buttons =====
    text(c, MARGIN, y, "Buttons", font="AlbertSans-Bold", size=14, color=BLACK)
    y -= 28

    btn_w, btn_h = 130, 36
    def draw_button(x, y, label, bg, fg, border=None, gradient=False):
        if gradient:
            # cheap fake gradient — two stacked rects
            c.setFillColor(INDIGO)
            c.rect(x, y, btn_w, btn_h, fill=1, stroke=0)
            c.setFillColor(Color(0.443, 0.348, 0.965, 0.4))
            c.rect(x, y + btn_h / 2, btn_w, btn_h / 2, fill=1, stroke=0)
        else:
            c.setFillColor(bg)
            if border:
                c.setStrokeColor(border)
                c.setLineWidth(0.7)
                c.rect(x, y, btn_w, btn_h, fill=1, stroke=1)
            else:
                c.rect(x, y, btn_w, btn_h, fill=1, stroke=0)
        c.setFillColor(fg)
        c.setFont("AlbertSans-Medium", 11)
        tw = c.stringWidth(label, "AlbertSans-Medium", 11)
        c.drawString(x + (btn_w - tw) / 2, y + btn_h / 2 - 4, label)

    draw_button(MARGIN, y - btn_h, "Primary action", INDIGO, WHITE,
                gradient=True)
    draw_button(MARGIN + 144, y - btn_h, "Secondary", WHITE, BLACK,
                border=BORDER)
    draw_button(MARGIN + 288, y - btn_h, "Ghost", CREAM, MUTED, border=None)
    draw_button(MARGIN + 432, y - btn_h, "Destructive", DESTRUCT, WHITE)

    y -= btn_h + 20
    text(c, MARGIN, y,
         "Primary uses an indigo to indigo-soft gradient. "
         "Secondary is bordered white. Use one primary per screen.",
         font="AlbertSans-Regular", size=10, color=MUTED)

    # ===== Cards =====
    y -= 40
    text(c, MARGIN, y, "Cards", font="AlbertSans-Bold", size=14, color=BLACK)
    y -= 22

    card_w, card_h = 230, 130
    # Card 1 - default white on cream
    c.setFillColor(WHITE)
    c.setStrokeColor(BORDER)
    c.setLineWidth(0.6)
    c.rect(MARGIN, y - card_h, card_w, card_h, fill=1, stroke=1)
    text(c, MARGIN + 16, y - 28, "EU Market Entry",
         font="AlbertSans-Bold", size=14, color=BLACK)
    text(c, MARGIN + 16, y - 44, "Lattice Pay · Fintech",
         font="AlbertSans-Regular", size=10, color=MUTED)
    # status pill
    c.setFillColor(Color(0.11, 0.54, 0.32, 0.14))
    c.roundRect(MARGIN + 16, y - 70, 48, 16, 8, fill=1, stroke=0)
    text(c, MARGIN + 23, y - 65, "ACTIVE",
         font="AlbertSans-Medium", size=8, color=SUCCESS)
    # progress
    c.setFillColor(BORDER)
    c.rect(MARGIN + 16, y - 95, card_w - 32, 3, fill=1, stroke=0)
    c.setFillColor(INDIGO)
    c.rect(MARGIN + 16, y - 95, (card_w - 32) * 0.7, 3, fill=1, stroke=0)
    text(c, MARGIN + 16, y - card_h + 16, "Week 12 / 12",
         font="AlbertSans-Regular", size=9, color=MUTED)
    text(c, MARGIN + card_w - 64, y - card_h + 16, "23h ago",
         font="AlbertSans-Regular", size=9, color=SUBTLE)

    # Card 2 - inverted indigo
    inv_x = MARGIN + card_w + 16
    c.setFillColor(INDIGO)
    c.rect(inv_x, y - card_h, card_w, card_h, fill=1, stroke=0)
    text(c, inv_x + 16, y - 28, "Brain ready",
         font="AlbertSans-Bold", size=14, color=WHITE)
    cream_70 = Color(0.94, 0.94, 0.92, 0.85)
    text(c, inv_x + 16, y - 46,
         "47 entities synced from 487 emails",
         font="AlbertSans-Regular", size=10, color=cream_70)
    # Draw a small white arrow + label
    draw_arrow(c, inv_x + 16, y - card_h + 12, size=12, color=WHITE)
    text(c, inv_x + 16 + 18, y - card_h + 16, "Open project",
         font="AlbertSans-Medium", size=11, color=WHITE)

    y -= card_h + 14
    text(c, MARGIN, y,
         "White cards are the workhorse. Indigo fills reserved for hero / "
         "moments of emphasis — never a sea of them.",
         font="AlbertSans-Regular", size=10, color=MUTED)

    # ===== Badges =====
    y -= 30
    text(c, MARGIN, y, "Badges", font="AlbertSans-Bold", size=14, color=BLACK)
    y -= 22

    def draw_badge(x, y, label, fill, fg, border=None):
        w = c.stringWidth(label, "AlbertSans-Medium", 9) + 16
        c.setFillColor(fill)
        if border:
            c.setStrokeColor(border)
            c.setLineWidth(0.5)
            c.roundRect(x, y, w, 16, 8, fill=1, stroke=1)
        else:
            c.roundRect(x, y, w, 16, 8, fill=1, stroke=0)
        text(c, x + 8, y + 4, label,
             font="AlbertSans-Medium", size=9, color=fg)
        return w

    x = MARGIN
    badges = [
        ("active", Color(0.11, 0.54, 0.32, 0.14), SUCCESS, None),
        ("at risk", Color(0.81, 0.50, 0.06, 0.14), WARNING, None),
        ("overdue", Color(0.80, 0.16, 0.16, 0.14), DESTRUCT, None),
        ("synced", Color(0.22, 0.07, 0.95, 0.10), INDIGO, None),
        ("draft", CREAM, MUTED, BORDER),
    ]
    for label, fill, fg, border in badges:
        bw = draw_badge(x, y - 16, label, fill, fg, border)
        x += bw + 10

    c.showPage()


def page_layout(c):
    fill_page(c, CREAM)
    page_header(c, "Layout & spacing", 7)

    y = PAGE_H - 100
    text(c, MARGIN, y, "Layout & spacing",
         font="AlbertSans-Bold", size=22, color=BLACK)
    y -= 28
    intro = ("Generous whitespace, clear hierarchy. The app uses an 8px base "
             "grid — every spacing value is a multiple of 4 (4, 8, 12, 16, "
             "24, 32, 48, 64).")
    for line in textwrap.wrap(intro, width=85):
        text(c, MARGIN, y, line, font="AlbertSans-Regular", size=10, color=MUTED)
        y -= 14
    y -= 16

    # Sketch of a page layout — sidebar + content
    text(c, MARGIN, y, "Page shell",
         font="AlbertSans-Bold", size=14, color=BLACK)
    y -= 26

    shell_x = MARGIN
    shell_y = y - 220
    shell_w = PAGE_W - MARGIN * 2
    shell_h = 220

    # Outer cream surface (just the bg again, with a thin border for clarity)
    c.setStrokeColor(BORDER)
    c.setLineWidth(0.5)
    c.rect(shell_x, shell_y, shell_w, shell_h, fill=0, stroke=1)

    # Sidebar
    side_w = 90
    c.setFillColor(WHITE)
    c.rect(shell_x, shell_y, side_w, shell_h, fill=1, stroke=0)
    c.setStrokeColor(BORDER)
    c.line(shell_x + side_w, shell_y, shell_x + side_w, shell_y + shell_h)
    # Tiny wordmark
    wordmark(c, shell_x + 10, shell_y + shell_h - 24, size=11)
    # Nav placeholders
    for i in range(4):
        c.setFillColor(BORDER if i != 1 else INDIGO)
        opacity = 1 if i == 1 else 0.4
        c.setFillColor(Color(0.22, 0.07, 0.95, 0.10) if i == 1 else BORDER)
        c.rect(shell_x + 10, shell_y + shell_h - 50 - i * 18, side_w - 20, 12,
               fill=1, stroke=0)

    # Content area placeholders
    content_x = shell_x + side_w + 16
    # Title bar
    text(c, content_x, shell_y + shell_h - 22, "Project page",
         font="AlbertSans-Bold", size=11, color=BLACK)
    # Cards
    for i in range(3):
        cx = content_x + i * 130
        c.setFillColor(WHITE)
        c.setStrokeColor(BORDER)
        c.rect(cx, shell_y + shell_h - 110, 120, 70, fill=1, stroke=1)
        c.setFillColor(INDIGO if i == 0 else BORDER)
        c.rect(cx + 8, shell_y + shell_h - 65, 30, 3, fill=1, stroke=0)
    # Bigger panel
    c.setFillColor(WHITE)
    c.setStrokeColor(BORDER)
    c.rect(content_x, shell_y + 16, shell_w - side_w - 32, 110,
           fill=1, stroke=1)
    text(c, content_x + 12, shell_y + 110, "Knowledge graph (dark)",
         font="AlbertSans-Regular", size=8, color=SUBTLE)
    c.setFillColor(BLACK)
    c.rect(content_x + 12, shell_y + 28, shell_w - side_w - 56, 70,
           fill=1, stroke=0)
    # Few nodes
    c.setFillColor(Color(0.13, 0.83, 0.93))
    c.circle(content_x + 60, shell_y + 70, 4, fill=1, stroke=0)
    c.circle(content_x + 110, shell_y + 50, 3, fill=1, stroke=0)
    c.setFillColor(INDIGO_SOFT)
    c.circle(content_x + 160, shell_y + 80, 4, fill=1, stroke=0)
    c.setFillColor(Color(1, 0.7, 0.3))
    c.circle(content_x + 220, shell_y + 55, 3, fill=1, stroke=0)

    y = shell_y - 14
    text(c, MARGIN, y,
         "Sidebar is white on cream. Cards are white. The knowledge graph "
         "keeps its dark canvas for visual drama.",
         font="AlbertSans-Regular", size=10, color=MUTED)

    # Spacing scale
    y -= 30
    text(c, MARGIN, y, "Spacing scale",
         font="AlbertSans-Bold", size=14, color=BLACK)
    y -= 22

    scales = [4, 8, 12, 16, 24, 32, 48, 64]
    x = MARGIN
    for s in scales:
        # box
        c.setFillColor(INDIGO)
        c.rect(x, y - 12, s, 12, fill=1, stroke=0)
        text(c, x, y - 26, f"{s}",
             font="AlbertSans-Regular", size=9, color=BLACK)
        x += max(s + 18, 32)

    c.showPage()


def page_dos_donts(c):
    fill_page(c, CREAM)
    page_header(c, "Do's & Don'ts", 8)

    y = PAGE_H - 100
    text(c, MARGIN, y, "Do's & Don'ts",
         font="AlbertSans-Bold", size=22, color=BLACK)
    y -= 38

    col_w = (PAGE_W - MARGIN * 2 - 24) / 2

    # Headers
    text(c, MARGIN, y, "DO",
         font="AlbertSans-Regular", size=11, color=SUCCESS)
    text(c, MARGIN + col_w + 24, y, "DON'T",
         font="AlbertSans-Regular", size=11, color=DESTRUCT)
    y -= 18

    dos = [
        ("Keep the logo wordmark lowercase",
         "The logo reads indigo iota. In running text, write Indigo Iota. "
         "Never IndigoIota or INDIGO IOTA."),
        ("Use indigo for one thing at a time",
         "A page should have one primary CTA, not five."),
        ("Lean on cream backgrounds",
         "Most surfaces are cream or white. Indigo is the spice."),
        ("Reserve serif italic for 'iota'",
         "Instrument Serif is for the brand mark only."),
        ("Use Albert Sans for technical chrome",
         "Counters, IDs, week numbers, hashes."),
        ("Keep the knowledge graph on dark",
         "The graph keeps its dark canvas for visual drama."),
    ]
    donts = [
        ("Don't redraw the iota italic in another font",
         "It must be Instrument Serif, italic 400."),
        ("Don't tint the wordmark",
         "Indigo, black, or cream only. No greys, no other hues."),
        ("Don't use indigo as body text",
         "Body is black. Indigo is for links, CTAs, and brand chrome."),
        ("Don't mix the old teal accent in",
         "We've moved off teal. Indigo is the sole accent."),
        ("Don't add a separate icon to the logo",
         "The wordmark IS the logo. No symbol next to it."),
        ("Don't put the wordmark on photography",
         "Use a flat cream or indigo background."),
    ]

    yl = y
    yr = y
    for title, body in dos:
        draw_check(c, MARGIN, yl - 1, size=11, color=SUCCESS)
        text(c, MARGIN + 18, yl, title,
             font="AlbertSans-Medium", size=11, color=BLACK)
        yl -= 14
        for line in textwrap.wrap(body, width=46):
            text(c, MARGIN + 18, yl, line,
                 font="AlbertSans-Regular", size=10, color=MUTED)
            yl -= 13
        yl -= 8

    for title, body in donts:
        draw_cross(c, MARGIN + col_w + 24, yr - 1, size=11, color=DESTRUCT)
        text(c, MARGIN + col_w + 42, yr, title,
             font="AlbertSans-Medium", size=11, color=BLACK)
        yr -= 14
        for line in textwrap.wrap(body, width=46):
            text(c, MARGIN + col_w + 42, yr, line,
                 font="AlbertSans-Regular", size=10, color=MUTED)
            yr -= 13
        yr -= 8

    c.showPage()


def page_closing(c):
    fill_page(c, INDIGO)

    # Big cream wordmark
    wordmark(c, MARGIN, PAGE_H / 2 + 20, size=80, color=CREAM)

    c.setFillColor(CREAM)
    c.setFont("AlbertSans-Regular", 16)
    c.drawString(MARGIN, PAGE_H / 2 - 25,
                 "the project brain for consultancies")

    cream_60 = Color(0.94, 0.94, 0.92, 0.6)
    c.setFont("AlbertSans-Regular", 9)
    c.setFillColor(cream_60)
    c.drawString(MARGIN, 60, "BRAND STYLE GUIDE  ·  v1  ·  2026")
    text_right(c, PAGE_W - MARGIN, 60, "indigo-iota.com",
               font="AlbertSans-Regular", size=9, color=cream_60)

    c.showPage()


# --- Main ------------------------------------------------------------------

def main():
    output_dir = "/Users/juliuskasiske/Documents/indigo_iota/frontend_demo/docs"
    os.makedirs(output_dir, exist_ok=True)
    output = f"{output_dir}/indigo-iota-style-guide.pdf"

    c = canvas.Canvas(output, pagesize=A4)
    c.setTitle("Indigo Iota — brand style guide")
    c.setAuthor("Indigo Iota")
    c.setSubject("Brand identity: wordmark, color, typography, components")
    c.setKeywords("brand, style guide, Indigo Iota")

    page_cover(c)
    page_logo(c)
    page_colors(c)
    page_typography(c)
    page_scale(c)
    page_components(c)
    page_layout(c)
    page_dos_donts(c)
    page_closing(c)

    c.save()
    print(f"Wrote: {output}")


if __name__ == "__main__":
    main()

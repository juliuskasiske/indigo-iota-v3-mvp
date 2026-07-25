#!/usr/bin/env python3
"""
Indigo Iota — Positionierungs-One-Pager (A4, Deutsch). Finalisierte Copy.

Systematische Typografie:
  * EIN Typenraster (feste pt-Größen je Rolle; keine Auto-Anpassung).
  * EIN Spacing-System (Basiseinheit 8 pt; jeder vertikale Abstand = Vielfaches).
    Überschüssiger Raum wird gleichmäßig über den Sektionsabstand verteilt.
  * Gleiche Seitenränder (MARGIN) und gleiches Box-Padding (PAD).

Regeln: kein Geviertstrich; immer „Kunde"; immer „Preis"; keine Mono-Schrift;
keine Caps-Labels.
"""

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

PAGE_W, PAGE_H = A4

# ---- Geometry -------------------------------------------------------------
MARGIN = 46
PAD = 14
CW = PAGE_W - 2 * MARGIN

# ---- ONE TYPE SCALE (fixed pt sizes; ratio ~1.25 between steps) -----------
T_H1    = 23     # headline
T_H2    = 14     # section headings (all identical)
T_H3    = 11     # card titles (all identical)
T_BODY  = 9      # every body / paragraph / lead / card body
T_SMALL = 8      # labels, trust strip, footer
T_NUM   = 17     # decorative card numerals (one consistent display size)
LEAD_BODY = 12
LEAD_H1   = 25

# ---- ONE SPACING SYSTEM (base unit U = 6) ---------------------------------
# Hierarchy by design: SECTION > HEAD > LABEL = INTRA.
U = 6
GAP_HEAD  = 2 * U   # 12  heading -> body
GAP_INTRA = 1 * U   # 6   element -> next element inside a block
GAP_LABEL = 1 * U   # 6   label -> heading
GAP_LIST  = 2 * U   # 12  between outcome items
CARD_GAP  = 2 * U   # 12  horizontal gap between cards / logo slots
GAP_SECTION_BASE = 3 * U  # 18  base section gap (slack added evenly on top)
N_SECTION_GAPS = 9        # 8 internal + 1 closing->footer

# ---- Colors ---------------------------------------------------------------
CREAM       = HexColor("#f0f0ec")
WHITE       = HexColor("#ffffff")
SURFACE_ALT = HexColor("#e6e6e0")
INDIGO      = HexColor("#3812f3")
INDIGO_TINT = HexColor("#e9e6fd")
BLACK       = HexColor("#0f0f0f")
MUTED       = HexColor("#616161")
SUBTLE      = HexColor("#8c8c8c")
BORDER      = HexColor("#d0cfc8")

TTF = "/tmp/ttf"
for _n in ["AlbertSans-Regular", "AlbertSans-Medium", "AlbertSans-Bold",
           "AlbertSans-ExtraBold", "InstrumentSerif-Italic"]:
    pdfmetrics.registerFont(TTFont(_n, f"{TTF}/{_n}.ttf"))
REG, MED, BOLD, XBOLD = ("AlbertSans-Regular", "AlbertSans-Medium",
                         "AlbertSans-Bold", "AlbertSans-ExtraBold")
SERIF = "InstrumentSerif-Italic"

LOGO_DIR = "/tmp/logos/mono"
LOGOS = [
    ("mckinsey_cream.png", 312, 94),
    ("accenture_cream.png", 492, 129),
    ("roland-berger_cream.png", 1000, 475),
    ("capgemini-invent_cream.png", 856, 135),
]


def sw(s, font, size):
    return pdfmetrics.stringWidth(s, font, size)


def text(c, x, y, s, font=REG, size=10, color=BLACK):
    c.setFont(font, size)
    c.setFillColor(color)
    c.drawString(x, y, s)


def text_right(c, x, y, s, font=REG, size=10, color=BLACK):
    c.setFont(font, size)
    c.setFillColor(color)
    c.drawRightString(x, y, s)


def text_center(c, cx, y, s, font=REG, size=10, color=BLACK):
    c.setFont(font, size)
    c.setFillColor(color)
    c.drawCentredString(cx, y, s)


def draw_segs(c, x, y, segs):
    to = c.beginText(x, y)
    for s, f, sz, col in segs:
        to.setFont(f, sz)
        to.setFillColor(col)
        to.textOut(s)
    c.drawText(to)


def rule(c, x1, y, x2, color=BORDER, w=0.6):
    c.setStrokeColor(color)
    c.setLineWidth(w)
    c.line(x1, y, x2, y)


def wrap(s, font, size, max_w):
    out, cur = [], ""
    for w in s.split():
        t = (cur + " " + w).strip()
        if sw(t, font, size) <= max_w:
            cur = t
        else:
            if cur:
                out.append(cur)
            cur = w
    if cur:
        out.append(cur)
    return out


def cap_h(font, size):
    return pdfmetrics.getFont(font).face.capHeight / 1000.0 * size


def desc_h(font, size):
    return abs(pdfmetrics.getFont(font).face.descent) / 1000.0 * size


def arrow_marker(c, x, y, size=10, color=INDIGO):
    c.setStrokeColor(color)
    c.setFillColor(color)
    c.setLineWidth(1.5)
    c.setLineCap(1)
    c.line(x, y + size * 0.34, x + size * 0.6, y + size * 0.34)
    p = c.beginPath()
    p.moveTo(x + size * 0.56, y + size * 0.13)
    p.lineTo(x + size * 0.82, y + size * 0.34)
    p.lineTo(x + size * 0.56, y + size * 0.55)
    p.close()
    c.drawPath(p, fill=1, stroke=0)


def _strip_default_helvetica(path):
    import re
    import pikepdf
    pdf = pikepdf.open(path, allow_overwriting_input=True)
    pg = pdf.pages[0]
    st = pg.Contents
    data = bytes(st.read_bytes())
    new = re.sub(rb"BT\s*/F1\s+[\d.]+\s+Tf\s+[\d.]+\s+TL\s+ET", b"", data,
                 count=1)
    st.write(new)
    if "/F1" in pg.Resources.Font:
        del pg.Resources.Font["/F1"]
    pdf.save(path)
    pdf.close()


def build(path, gap_section, marks=None):
    """Draw the page. `gap_section` is the (single) section gap. If `marks` is a
    list, layout coordinates are appended for the measured-gap report."""
    c = canvas.Canvas(path, pagesize=A4)
    c.setFont(REG, 10)
    c.setFillColor(CREAM)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    R = PAGE_W - MARGIN
    GS = gap_section

    def rec(name, kind, yy):
        if marks is not None:
            marks.append((name, kind, round(yy, 2)))

    # ===== Header bar ======================================================
    head_base = PAGE_H - MARGIN - 12
    ws = 17
    cs = -0.03 * ws
    to = c.beginText(MARGIN, head_base)
    to.setFont(XBOLD, ws)
    to.setCharSpace(cs)
    to.setFillColor(INDIGO)
    to.textOut("indigo")
    c.drawText(to)
    iw = sw("indigo", XBOLD, ws) + 6 * cs
    text(c, MARGIN + iw + 0.04 * ws, head_base, "iota", font=SERIF, size=ws,
         color=INDIGO)
    text_right(c, R, head_base + 1, "Positionierung · 2026",
               font=REG, size=T_SMALL, color=SUBTLE)
    rule_y = head_base - 15
    rule(c, MARGIN, rule_y, R, BORDER, 0.6)

    # ---- visual-whitespace flow: `cursor` = visual bottom of last element --
    cursor = [rule_y]

    def emit(name, top, bottom):
        if marks is not None:
            marks.append((name, round(top, 2), round(bottom, 2)))

    def line(gap, s, font, size, color, name):
        base = cursor[0] - gap - cap_h(font, size)
        text(c, MARGIN, base, s, font=font, size=size, color=color)
        bottom = base - desc_h(font, size)
        emit(name, base + cap_h(font, size), bottom)
        cursor[0] = bottom
        return base

    def paragraph(gap, s, font, size, color, name, max_w=CW):
        lines = wrap(s, font, size, max_w)
        base = cursor[0] - gap - cap_h(font, size)
        yy = base
        for ln in lines:
            text(c, MARGIN, yy, ln, font=font, size=size, color=color)
            yy -= LEAD_BODY
        last = yy + LEAD_BODY
        bottom = last - desc_h(font, size)
        emit(name, base + cap_h(font, size), bottom)
        cursor[0] = bottom

    # ===== Headline (H1) + subline (body) =================================
    base1 = cursor[0] - GS - cap_h(XBOLD, T_H1)
    text(c, MARGIN, base1, "Berater sind Problemlöser,", font=XBOLD, size=T_H1,
         color=BLACK)
    base2 = base1 - LEAD_H1
    draw_segs(c, MARGIN, base2, [("KI-Agenten", SERIF, T_H1 + 2, INDIGO),
                                 (" sind es auch", XBOLD, T_H1, BLACK)])
    cursor[0] = base2 - desc_h(XBOLD, T_H1)
    emit("Headline", base1 + cap_h(XBOLD, T_H1), cursor[0])
    paragraph(GAP_HEAD, "Wir begleiten Beratungen durch die KI-Transformation, "
              "vom ersten Schritt bis zur KI-nativen Organisation.",
              REG, T_BODY, MUTED, "Headline body")

    def section(label_s, head_s, body_s):
        line(GS, label_s, MED, T_SMALL, INDIGO, label_s + " (label)")
        line(GAP_LABEL, head_s, BOLD, T_H2, BLACK, label_s + " (heading)")
        paragraph(GAP_HEAD, body_s, REG, T_BODY, MUTED, label_s + " (body)")

    section("Die neue Realität",
            "KI-Agenten lösen Aufgaben, für die man früher ein Team buchte.",
            "Kunden wissen das und wollen den Effizienzgewinn im Preis "
            "wiederfinden.")

    section("Ihr Vorsprung",
            "Ihre Expertise ist der Vorsprung, den keine KI mitbringt.",
            "Was Ihre besten Berater über Jahre aufgebaut haben, lässt sich "
            "nicht herunterladen. Der Vorsprung von morgen entsteht dort, wo "
            "diese Expertise auf KI trifft.")

    # ===== Section: So gehen wir vor (cards) ==============================
    line(GS, "So gehen wir vor", MED, T_SMALL, INDIGO, "So gehen (label)")
    line(GAP_LABEL, "Wir gehen den Weg mit, Schritt für Schritt.",
         BOLD, T_H2, BLACK, "So gehen (heading)")
    cards = [
        ("01", "Grundlage schaffen",
         "Verstreutes Projektwissen wird zu einer Grundlage, auf die KI "
         "zugreifen kann."),
        ("02", "Agenten an die Arbeit",
         "KI-Agenten arbeiten mit dem Wissen Ihrer Projekte für Recherche, "
         "Entwurf und Delivery. Ihre Daten bleiben dabei intern und fließen "
         "in kein fremdes Modell."),
        ("03", "Vorsprung sichern",
         "Wir verankern KI in Prozessen, Teams und Delivery, bis es "
         "selbstverständlich ist."),
    ]
    cw = (CW - 2 * CARD_GAP) / 3
    body_w = cw - 2 * PAD
    wrapped = [wrap(b[2], REG, T_BODY, body_w) for b in cards]
    maxlines = max(len(w) for w in wrapped)
    cn, dn = cap_h(SERIF, T_NUM), desc_h(SERIF, T_NUM)
    ctt, dtt = cap_h(BOLD, T_H3), desc_h(BOLD, T_H3)
    cbb, dbb = cap_h(REG, T_BODY), desc_h(REG, T_BODY)
    card_h = (PAD + cn + dn + GAP_INTRA + ctt + dtt + GAP_INTRA
              + cbb + (maxlines - 1) * LEAD_BODY + dbb + PAD)
    card_top = cursor[0] - GAP_HEAD
    cby = card_top - card_h
    for i, (num, title, _b) in enumerate(cards):
        cx0 = MARGIN + i * (cw + CARD_GAP)
        c.setFillColor(WHITE)
        c.roundRect(cx0, cby, cw, card_h, 5, fill=1, stroke=0)
        ix = cx0 + PAD
        nb = card_top - PAD - cn
        text(c, ix, nb, num, font=SERIF, size=T_NUM, color=INDIGO)
        tb = (nb - dn) - GAP_INTRA - ctt
        text(c, ix, tb, title, font=BOLD, size=T_H3, color=BLACK)
        yy = (tb - dtt) - GAP_INTRA - cbb
        for ln in wrapped[i]:
            text(c, ix, yy, ln, font=REG, size=T_BODY, color=MUTED)
            yy -= LEAD_BODY
    emit("Cards", card_top, cby)
    cursor[0] = cby

    # ===== Section: Gebaut von Beratern aus (logos) =======================
    line(GS, "Gebaut von Beratern aus", MED, T_SMALL, INDIGO, "Logos (label)")
    logo_band = 20
    logos_top = cursor[0] - GAP_HEAD
    box_h, box_w = 21.0, 100.0
    slot_w = CW / 4
    yc = logos_top - logo_band / 2
    for i, (fn, nw, nh) in enumerate(LOGOS):
        ratio = nw / nh
        h = min(box_h, box_w / ratio)
        w = h * ratio
        slot_left = MARGIN + i * slot_w
        c.drawImage(ImageReader(f"{LOGO_DIR}/{fn}"),
                    slot_left + (slot_w - w) / 2, yc - h / 2,
                    width=w, height=h, preserveAspectRatio=True, mask=None)
    emit("Logos", logos_top, logos_top - logo_band)
    cursor[0] = logos_top - logo_band

    # ===== Section: Was das ... bedeutet (outcomes) =======================
    line(GS, "Was das für Ihr Beratungshaus bedeutet", MED, T_SMALL, INDIGO,
         "Outcomes (label)")
    outcomes = [
        "Sie werden zur KI-nativen Beratung, statt überholt zu werden.",
        "Ihr Wissen wird zum Vorsprung, den niemand kopiert.",
        "Junior-Leverage wird neu erfunden, nicht wegrationalisiert.",
        "Ein Partner an Ihrer Seite, kein weiteres Tool.",
    ]
    cob, dob = cap_h(MED, T_BODY), desc_h(MED, T_BODY)
    step = GAP_LIST + cob + dob
    base = cursor[0] - GAP_HEAD - cob
    top0 = base + cob
    for j, o in enumerate(outcomes):
        arrow_marker(c, MARGIN, base - 1, size=10, color=INDIGO)
        text(c, MARGIN + 18, base, o, font=MED, size=T_BODY, color=BLACK)
        if j < len(outcomes) - 1:
            base -= step
    emit("Outcomes", top0, base - dob)
    cursor[0] = base - dob

    # ===== Section: Trust strip ===========================================
    th = 22
    trust_top = cursor[0] - GS
    c.setFillColor(SURFACE_ALT)
    c.roundRect(MARGIN, trust_top - th, CW, th, 4, fill=1, stroke=0)
    text_center(c, PAGE_W / 2, trust_top - th + (th - T_SMALL) / 2 + 0.5,
                "EU-gehostet     ·     Lokale Embeddings     ·     "
                "Isolierte Kundendaten     ·     DSGVO & AVV",
                font=MED, size=T_SMALL, color=MUTED)
    emit("Trust", trust_top, trust_top - th)
    cursor[0] = trust_top - th

    # ===== Section: Closing ===============================================
    panel_h = 46
    closing_top = cursor[0] - GS
    py = closing_top - panel_h
    c.setFillColor(INDIGO_TINT)
    c.roundRect(MARGIN, py, CW, panel_h, 6, fill=1, stroke=0)
    text(c, MARGIN + PAD, py + panel_h - PAD - cap_h(BOLD, T_H3),
         "Sehen Sie es an einem laufenden Projekt.",
         font=BOLD, size=T_H3, color=BLACK)
    draw_segs(c, MARGIN + PAD, py + PAD,
              [("Schreiben Sie uns: ", REG, T_BODY, MUTED),
               ("hey@indigo-iota.com", BOLD, T_BODY, INDIGO)])
    emit("Closing", closing_top, py)

    # ===== Footer (anchored: equal bottom margin) =========================
    foot_base = MARGIN + 2
    foot_rule_y = foot_base + 13
    rule(c, MARGIN, foot_rule_y, R, BORDER, 0.6)
    text_center(c, PAGE_W / 2, foot_base,
                "indigo-iota.com     ·     hey@indigo-iota.com",
                font=REG, size=T_SMALL, color=SUBTLE)

    c.showPage()
    c.save()
    _strip_default_helvetica(path)
    return py, foot_rule_y, card_h, maxlines


if __name__ == "__main__":
    out = "/sessions/intelligent-upbeat-galileo/mnt/outputs/indigo-iota-positionierung-beratungen.pdf"
    # pass 1: measure slack with base section gap
    py0, foot_rule_y, _, _ = build(out, GAP_SECTION_BASE)
    # py(gs) = A - 8*gs  ->  A = py0 + 8*GAP_SECTION_BASE
    A = py0 + 8 * GAP_SECTION_BASE
    gs = (A - foot_rule_y) / N_SECTION_GAPS     # makes all 9 section gaps equal
    # pass 2: final, with even section gap + record marks
    marks = []
    py, foot_rule_y, card_h, maxlines = build(out, gs, marks=marks)
    print(f"GAP_SECTION (even) = {gs:.2f} pt | closing_bottom={py:.1f} "
          f"footer_rule={foot_rule_y:.1f} closing->footer={py-foot_rule_y:.1f} "
          f"| card_h={card_h:.1f} maxlines={maxlines}")
    print("wrote", out)

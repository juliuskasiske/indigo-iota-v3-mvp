#!/usr/bin/env python3
"""Generate the Indigo Iota tech-stack PDF (on-brand: cream + indigo,
Albert Sans + Instrument Serif)."""

import os
import urllib.request

from reportlab.lib.colors import Color, HexColor
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    HRFlowable,
    KeepTogether,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

PAGE_W, PAGE_H = A4
MARGIN = 50

# --- Colors ---
CREAM = HexColor("#f0f0ec")
WHITE = HexColor("#ffffff")
INDIGO = HexColor("#3812f3")
INDIGO_SOFT = HexColor("#7159f6")
BLACK = HexColor("#0f0f0f")
MUTED = HexColor("#5a5a5a")
SUBTLE = HexColor("#8c8c8c")
BORDER = HexColor("#d0cfc8")
INDIGO_TINT = Color(0.22, 0.07, 0.95, 0.06)

# --- Fonts (Fontsource CDN) ---
FONTS_DIR = "/tmp/iota_fonts"
os.makedirs(FONTS_DIR, exist_ok=True)
FONT_FILES = [
    ("AlbertSans-Regular", "https://cdn.jsdelivr.net/fontsource/fonts/albert-sans@latest/latin-400-normal.ttf"),
    ("AlbertSans-Medium", "https://cdn.jsdelivr.net/fontsource/fonts/albert-sans@latest/latin-500-normal.ttf"),
    ("AlbertSans-Bold", "https://cdn.jsdelivr.net/fontsource/fonts/albert-sans@latest/latin-700-normal.ttf"),
    ("AlbertSans-ExtraBold", "https://cdn.jsdelivr.net/fontsource/fonts/albert-sans@latest/latin-800-normal.ttf"),
    ("InstrumentSerif-Italic", "https://cdn.jsdelivr.net/fontsource/fonts/instrument-serif@latest/latin-400-italic.ttf"),
]
for name, url in FONT_FILES:
    target = f"{FONTS_DIR}/{name}.ttf"
    if not os.path.exists(target):
        urllib.request.urlretrieve(url, target)
    pdfmetrics.registerFont(TTFont(name, target))

# --- Styles ---
def style(name, **kw):
    base = dict(fontName="AlbertSans-Regular", fontSize=10, leading=14.5,
                textColor=BLACK, alignment=TA_LEFT, spaceBefore=0, spaceAfter=0)
    base.update(kw)
    return ParagraphStyle(name, **base)

S_WORDMARK = style("wm", fontSize=34, leading=38, textColor=INDIGO)
S_SUB = style("sub", fontName="AlbertSans-Regular", fontSize=13, leading=18, textColor=BLACK)
S_META = style("meta", fontName="AlbertSans-Regular", fontSize=8.5, leading=12, textColor=SUBTLE)
S_INTRO = style("intro", fontSize=11, leading=17, textColor=MUTED, spaceAfter=4)
S_H2 = style("h2", fontName="AlbertSans-Bold", fontSize=14, leading=18, textColor=BLACK,
             spaceBefore=18, spaceAfter=7)
S_BODY = style("body", fontSize=10, leading=15, textColor=MUTED, spaceAfter=7)
S_ITEM = style("item", fontSize=10, leading=15, textColor=MUTED, spaceAfter=6,
               leftIndent=16, firstLineIndent=-16)
S_QUOTE = style("quote", fontName="AlbertSans-Regular", fontSize=11, leading=17,
                textColor=BLACK)
# table cell styles
S_TH = style("th", fontName="AlbertSans-Bold", fontSize=8.5, leading=11, textColor=CREAM)
S_LAYER = style("layer", fontName="AlbertSans-Bold", fontSize=8.7, leading=11.5, textColor=BLACK)
S_CHOICE = style("choice", fontName="AlbertSans-Medium", fontSize=8.7, leading=11.5, textColor=INDIGO)
S_WHY = style("why", fontName="AlbertSans-Regular", fontSize=8.5, leading=11.5, textColor=MUTED)


def lead(label, rest, color=INDIGO):
    """Paragraph with a bold colored lead phrase + muted remainder."""
    hexc = "#%02x%02x%02x" % (int(color.red * 255), int(color.green * 255), int(color.blue * 255))
    return Paragraph(
        f'<font name="AlbertSans-Bold" color="{hexc}">{label}</font> {rest}',
        S_ITEM,
    )


# --- Page background + footer ---
def on_page(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(CREAM)
    canvas.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    # footer
    canvas.setFont("AlbertSans-Regular", 8)
    canvas.setFillColor(SUBTLE)
    canvas.drawString(MARGIN, 30, "Indigo Iota · platform architecture")
    canvas.drawRightString(PAGE_W - MARGIN, 30, f"{doc.page}")
    canvas.restoreState()


def build():
    out_dir = "/Users/juliuskasiske/Documents/indigo_iota/frontend_demo/docs"
    os.makedirs(out_dir, exist_ok=True)
    path = f"{out_dir}/indigo-iota-tech-stack.pdf"

    doc = BaseDocTemplate(
        path, pagesize=A4,
        leftMargin=MARGIN, rightMargin=MARGIN, topMargin=MARGIN, bottomMargin=48,
        title="Indigo Iota — Platform architecture & tech stack",
        author="Indigo Iota",
        subject="Tech stack for scaling the platform",
    )
    frame = Frame(MARGIN, 48, PAGE_W - 2 * MARGIN, PAGE_H - MARGIN - 48, id="f")
    doc.addPageTemplates([PageTemplate(id="main", frames=[frame], onPage=on_page)])

    story = []

    # Header
    story.append(Paragraph(
        '<font name="AlbertSans-ExtraBold">indigo</font>'
        '<font name="InstrumentSerif-Italic">iota</font>',
        S_WORDMARK,
    ))
    story.append(Spacer(1, 6))
    story.append(Paragraph("Platform architecture &amp; tech stack", S_SUB))
    story.append(Spacer(1, 3))
    story.append(Paragraph("How we&rsquo;d build &amp; scale the platform · v1", S_META))
    story.append(Spacer(1, 12))
    story.append(HRFlowable(width="100%", thickness=0.6, color=BORDER,
                            spaceBefore=0, spaceAfter=12))

    # Intro
    story.append(Paragraph(
        "The strongest answer is also the honest one: <b>the prototype stack is "
        "basically the production stack &mdash; scaling Indigo Iota is hardening, "
        "not rewriting.</b> The principle throughout is to avoid premature "
        "complexity, keep the data layer simple, and spend engineering cycles on "
        "extraction quality rather than undifferentiated plumbing.",
        S_INTRO,
    ))

    # Guiding principles
    story.append(Paragraph("Guiding principles", S_H2))
    story.append(lead("One database until it screams.",
        "Postgres handles relational data, vectors, full-text, and the graph. "
        "Resist polyglot persistence."))
    story.append(lead("Python for the AI core, TypeScript for the app.",
        "Don&rsquo;t fight the ecosystems."))
    story.append(lead("Buy the undifferentiated plumbing.",
        "OAuth/sync, auth/SSO, LLM observability. The moat is extraction quality "
        "and graph-grounded answers &mdash; not the Slack connector."))
    story.append(lead("EU-sovereign by construction.",
        "It&rsquo;s our wedge with European consultancies."))

    # The stack table
    story.append(Paragraph("The stack", S_H2))
    rows = [
        [Paragraph("Layer", S_TH), Paragraph("Choice", S_TH), Paragraph("Why", S_TH)],
        ["Web app", "Next.js (App Router) + TypeScript + Tailwind + shadcn",
         "Already the demo stack. Hireable, fast; great for the real-time 3D graph (react-force-graph / Three.js) and SSE-driven live updates."],
        ["Core API + AI", "Python + FastAPI",
         "The extraction pipeline, embeddings, RAG, and agent orchestration live in Python&rsquo;s ecosystem. Async, production-grade."],
        ["Datastore", "Postgres (EU region) &mdash; pgvector (HNSW), tsvector/GIN, JSONB",
         "Hybrid search, relational data, and the graph in one place. Scales further than people assume."],
        ["Graph", "Stay in Postgres (nodes/edges + recursive CTEs)",
         "Queries are 1&ndash;2 hop. No Neo4j until multi-hop graph analytics become a feature &mdash; early graph-DB adoption is a premature-complexity trap."],
        ["Async / ingestion", "Job queue + workers (Redis + RQ/Celery now; Temporal later)",
         "Ingestion is continuous, bursty, multi-step per document; needs durable retryable workflows + a global LLM-concurrency cap."],
        ["Connectors", "Microsoft Graph, Gmail API, Slack Events API &mdash; via a unified layer (Nango, self-hostable)",
         "OAuth, token refresh, delta sync, webhooks &mdash; months of plumbing not to hand-roll. Self-hostable keeps it EU-sovereign."],
        ["LLM", "Model-agnostic gateway (LiteLLM) + per-tenant model policy",
         "Route sovereignty-sensitive tenants to EU-hosted models (Mistral, Azure OpenAI EU, self-hosted); frontier models where permitted. Never hardcode a provider."],
        ["Embeddings", "Self-hosted (bge / open model, ONNX)",
         "Cheaper, no data egress, sovereignty-clean."],
        ["Auth", "WorkOS (or Clerk)",
         "Consultancies demand SSO/SAML + SCIM directory sync on day one of any enterprise deal."],
        ["Files", "S3-compatible, EU region (S3 Frankfurt, or MinIO/Scaleway)",
         "Mirror SharePoint files + attachments."],
        ["Infra", "Managed containers (Fly.io / ECS-Fargate / Scaleway, EU) + managed Postgres (Neon/Supabase EU, RDS Frankfurt)",
         "Kubernetes only when you&rsquo;ve outgrown this &mdash; not before."],
        ["Observability", "Sentry + OpenTelemetry + Langfuse (self-hostable)",
         "Token- and quality-bound; you need LLM tracing, evals, and cost visibility early."],
    ]
    table_data = [rows[0]] + [
        [Paragraph(r[0], S_LAYER), Paragraph(r[1], S_CHOICE), Paragraph(r[2], S_WHY)]
        for r in rows[1:]
    ]
    tbl = Table(table_data, colWidths=[78, 150, 267], repeatRows=1)
    ts = [
        ("BACKGROUND", (0, 0), (-1, 0), INDIGO),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, BORDER),
        ("LINEBELOW", (0, 0), (-1, 0), 0, INDIGO),
    ]
    # alternating row backgrounds
    for i in range(1, len(table_data)):
        if i % 2 == 1:
            ts.append(("BACKGROUND", (0, i), (-1, i), WHITE))
        else:
            ts.append(("BACKGROUND", (0, i), (-1, i), Color(1, 1, 1, 0.45)))
    tbl.setStyle(TableStyle(ts))
    story.append(tbl)

    # 3 decisions
    story.append(Paragraph("The three decisions that actually matter", S_H2))
    story.append(lead("Multi-tenant data isolation.",
        "Product and sales, not just infra. Default: shared Postgres + tenant_id + "
        "Row-Level Security. Offer single-tenant / dedicated-DB deployment for the "
        "enterprise tier &mdash; &ldquo;your data never co-mingles&rdquo; is a "
        "closing lever, not a cost."))
    story.append(lead("Where the models run.",
        "A per-tenant model policy is the technical expression of the "
        "EU-sovereignty pitch. Get it wrong and the wedge evaporates."))
    story.append(lead("Buy vs. build the connectors.",
        "The real engineering surface area is reliable incremental sync across "
        "email/Slack/SharePoint, not the AI. Lean on a unified integration layer."))

    # Not early
    story.append(Paragraph("What we&rsquo;d deliberately not do early", S_H2))
    story.append(Paragraph(
        "Neo4j, a separate vector DB (Qdrant/Pinecone), microservices, Kubernetes, "
        "Kafka. Each is a plausible &ldquo;scale&rdquo; answer and each would slow "
        "us down now. They&rsquo;re escape hatches with clear trigger conditions "
        "(e.g. move vectors to Qdrant when per-tenant recall/latency on pgvector "
        "degrades), not day-one choices.",
        S_BODY,
    ))

    # At-a-glance summary (structured, in an indigo callout)
    glance_heading = Paragraph("At a glance", S_H2)

    s_gl_label = style("gllabel", fontName="AlbertSans-Bold", fontSize=9,
                       leading=12, textColor=INDIGO)

    def gl_value(tech, rest):
        return Paragraph(
            f'<font name="AlbertSans-Medium" color="#0f0f0f">{tech}</font> '
            f'<font color="#5a5a5a">&mdash; {rest}</font>',
            style("glvalue", fontName="AlbertSans-Regular", fontSize=9, leading=12),
        )

    glance = [
        ("Core API", gl_value("Python + FastAPI",
            "extraction pipeline, embeddings, RAG, and agent orchestration.")),
        ("Database", gl_value("Postgres for everything",
            "relational, vector (pgvector), full-text, and the graph in one store.")),
        ("Frontend", gl_value("Next.js + TypeScript",
            "the dashboard, the live 3D graph, and streamed briefings.")),
        ("Ingestion", gl_value("A durable job queue",
            "continuous, multi-step sync across email, Slack, and SharePoint.")),
        ("Ancillary", gl_value("LLM gateway · observability · OAuth/sync · SSO",
            "bought, not built &mdash; so we spend our time on extraction quality.")),
        ("Uniquely ours", gl_value("Per-tenant model policy + Row-Level-Security",
            "single-tenant deployments for enterprise &mdash; the EU-sovereignty promise that wins European consultancies.")),
        ("Maturity", gl_value("Already running the prototype",
            "scaling it is hardening, not a rewrite.")),
    ]
    glance_rows = [[Paragraph(label, s_gl_label), value] for label, value in glance]
    callout = Table(glance_rows, colWidths=[105, PAGE_W - 2 * MARGIN - 105 - 28])
    cs = [
        ("BACKGROUND", (0, 0), (-1, -1), INDIGO_TINT),
        ("LINEBEFORE", (0, 0), (0, -1), 2.5, INDIGO),
        ("LEFTPADDING", (0, 0), (0, -1), 14),
        ("LEFTPADDING", (1, 0), (1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 14),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]
    callout.setStyle(TableStyle(cs))
    # Keep the heading + box together so the summary never splits across pages.
    story.append(KeepTogether([glance_heading, Spacer(1, 2), callout]))

    doc.build(story)
    print("Wrote", path)


if __name__ == "__main__":
    build()

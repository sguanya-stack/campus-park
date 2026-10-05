"""
Generate campuspark_final.pdf using ReportLab.
Run: python3 generate_pdf.py
"""
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, PageBreak
)
from reportlab.platypus import Image as RLImage
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
import os

def _add_header_footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 8.5)
    canvas.setFillColor(colors.HexColor("#5a6e82"))
    canvas.drawString(doc.leftMargin, doc.pagesize[1] - 0.55*inch, "INFO 5100")
    canvas.drawRightString(doc.pagesize[0] - doc.rightMargin, doc.pagesize[1] - 0.55*inch,
                           "CampusPark — Final Project Report")
    canvas.drawCentredString(doc.pagesize[0] / 2, 0.5*inch, str(canvas.getPageNumber()))
    canvas.restoreState()

OUTPUT = os.path.join(os.path.dirname(__file__), "campuspark_final.pdf")
UML_PDF = os.path.join(os.path.dirname(__file__), "uml", "campuspark-uml.pdf")
UML_PNG = os.path.join(os.path.dirname(__file__), "uml", "campuspark-uml.pdf.png")

# ── Styles ────────────────────────────────────────────────────────────────────
base = getSampleStyleSheet()
TEAL = colors.HexColor("#0abab5")
DARK = colors.HexColor("#1e2d3d")
MUTED = colors.HexColor("#5a6e82")

def S(name, **kw):
    return ParagraphStyle(name, **kw)

title_style = S("Title2",
    fontSize=22, leading=26, textColor=DARK,
    fontName="Helvetica-Bold", alignment=TA_CENTER, spaceAfter=4)
subtitle_style = S("Subtitle2",
    fontSize=13, leading=17, textColor=MUTED,
    fontName="Helvetica", alignment=TA_CENTER, spaceAfter=4)
author_style = S("Author2",
    fontSize=11, leading=14, textColor=MUTED,
    fontName="Helvetica", alignment=TA_CENTER, spaceAfter=14)
h1_style = S("H1",
    fontSize=13, leading=17, textColor=TEAL,
    fontName="Helvetica-Bold", spaceBefore=14, spaceAfter=5)
h2_style = S("H2",
    fontSize=11, leading=14, textColor=DARK,
    fontName="Helvetica-Bold", spaceBefore=8, spaceAfter=4)
body_style = S("Body2",
    fontSize=10, leading=14, textColor=DARK,
    fontName="Helvetica", alignment=TA_JUSTIFY, spaceAfter=6)
bullet_style = S("Bullet2",
    fontSize=10, leading=14, textColor=DARK,
    fontName="Helvetica", leftIndent=18, bulletIndent=6,
    spaceBefore=1, spaceAfter=1, bulletFontName="Helvetica")
caption_style = S("Caption",
    fontSize=9, leading=12, textColor=MUTED,
    fontName="Helvetica-Oblique", alignment=TA_CENTER, spaceAfter=8)
code_style = S("Code2",
    fontSize=9, leading=12, textColor=DARK,
    fontName="Courier", leftIndent=18, spaceAfter=4)

def h1(text): return Paragraph(text, h1_style)
def h2(text): return Paragraph(text, h2_style)
def p(text):  return Paragraph(text, body_style)
def sp(n=6):  return Spacer(1, n)
def hr():     return HRFlowable(width="100%", thickness=0.5, color=TEAL, spaceAfter=4)

def bullets(items, numbered=False):
    out = []
    for i, item in enumerate(items, 1):
        prefix = f"{i}." if numbered else "•"
        out.append(Paragraph(f"<b>{prefix}</b> {item}", bullet_style))
    return out

# ── Document ──────────────────────────────────────────────────────────────────
def build_doc():
    doc = SimpleDocTemplate(
        OUTPUT,
        pagesize=letter,
        leftMargin=1*inch, rightMargin=1*inch,
        topMargin=0.85*inch, bottomMargin=0.85*inch,
        title="CampusPark Final Project Report — INFO 5100",
        author="Guanya Song"
    )

    story = []

    # ── Title block
    story += [
        Spacer(1, 14),
        Paragraph("CampusPark", title_style),
        Paragraph("Smart Campus Parking Reservation System", subtitle_style),
        Paragraph("Final Project Report &nbsp;·&nbsp; Phase II", subtitle_style),
        Paragraph("Guanya Song &nbsp;·&nbsp; April 2026", author_style),
        hr(),
        sp(4),
    ]

    # ── 1. Overview
    story += [
        h1("1. Project Overview"),
        p("CampusPark is a web application for reserving campus parking spots around "
          "the Seattle area. Students and visitors can search available lots, book a "
          "spot in advance, check in at the gate with a 6-digit ticket code, and check "
          "out with automatic fee calculation. Administrators get a dashboard showing "
          "occupancy, revenue, and user activity over time."),
        p("The motivation came from how hard it is to find parking on campus when you "
          "arrive without knowing which lots are full. Most systems only show a static "
          "map. This project tries to fix that by showing live availability and helping "
          "users pick a lot based on where they are coming from."),
        p("The three main parts of the system are:"),
    ]
    story += bullets([
        "<b>Live availability</b> — spot counters update every time a reservation is "
        "created, checked in, or cancelled. A background job also simulates realistic "
        "occupancy changes every 15 minutes.",
        "<b>Route-based recommendation</b> — the user enters a departure address or ZIP "
        "code, the server geocodes it, and scores each lot by distance, price, and "
        "availability to suggest the best option.",
        "<b>Reservation lifecycle</b> — a booking starts as PENDING, moves to ACTIVE "
        "after ticket check-in, and closes as COMPLETED at checkout. Unclaimed PENDING "
        "reservations expire after 5 minutes so the spot becomes available again.",
    ])

    # ── 2. Architecture
    story += [
        sp(8),
        h1("2. System Architecture"),
        h2("2.1 UML Component Diagram"),
        p("Figure 1 shows the UML Component Diagram produced for Assignment 5. "
          "The system is structured across four tiers: Browser SPA, Node.js Backend, "
          "Prisma ORM, and PostgreSQL Database."),
    ]

    # Insert UML image (PNG version of the PDF)
    uml_img_path = UML_PNG if os.path.exists(UML_PNG) else None
    if uml_img_path:
        try:
            img = RLImage(uml_img_path, width=6.2*inch, height=3.5*inch)
            story.append(img)
        except Exception as e:
            story.append(p(f"[UML diagram: see campuspark-uml.pdf in deliverables/uml/]"))
    else:
        story.append(p("[UML diagram: see campuspark-uml.pdf in deliverables/uml/]"))
    story.append(Paragraph("Figure 1. CampusPark UML Component Diagram (Assignment 5).", caption_style))

    story += [
        h2("2.2 Component Descriptions"),
    ]
    components = [
        ("Browser SPA", "index.html, app.js, styles.css",
         "Client-side routing, all view rendering, funnel analytics batching, "
         "feature-flag loader, dark mode, address autocomplete, QR ticket display."),
        ("PWA Shell", "manifest.json, service-worker.js",
         "Home-screen installation on iOS/Android; caches application shell."),
        ("Map / Navigation", "Leaflet + OSRM + Nominatim",
         "OpenStreetMap tiles, MarkerCluster aggregation, Leaflet.heat demand "
         "heatmap, driving-route polylines from AI recommendations."),
        ("Node.js Backend", "server.js (~2,000 lines)",
         "REST API routing, static file serving, scrypt auth, rate limiting, "
         "structured JSON logging with X-Request-ID, cron expiry job."),
        ("Prisma ORM", "prisma/schema.prisma",
         "Type-safe DB access. Six models: AppUser, AppSession, ParkingSpot, "
         "Reservation, FunnelEvent, FeatureFlag."),
        ("PostgreSQL", "Hosted via DATABASE_URL",
         "Persistent state. Atomic LEAST() updates prevent counter overflow."),
    ]
    tdata = [["Component", "Files", "Responsibility"]]
    for name, files, resp in components:
        tdata.append([name, files, resp])
    tbl = Table(tdata, colWidths=[1.3*inch, 1.6*inch, 3.5*inch])
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,0), TEAL),
        ("TEXTCOLOR",  (0,0), (-1,0), colors.white),
        ("FONTNAME",   (0,0), (-1,0), "Helvetica-Bold"),
        ("FONTSIZE",   (0,0), (-1,-1), 8.5),
        ("LEADING",    (0,0), (-1,-1), 12),
        ("ROWBACKGROUNDS", (0,1), (-1,-1), [colors.white, colors.HexColor("#f0fafa")]),
        ("GRID", (0,0), (-1,-1), 0.4, colors.HexColor("#b0dede")),
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("LEFTPADDING", (0,0), (-1,-1), 6),
        ("RIGHTPADDING", (0,0), (-1,-1), 6),
        ("TOPPADDING", (0,0), (-1,-1), 4),
        ("BOTTOMPADDING", (0,0), (-1,-1), 4),
    ]))
    story += [tbl, sp(8)]

    # ── 3. Core Features
    story += [
        h1("3. Core Features"),
        h2("3.1 Search and Reservation"),
        p("Users can filter by keyword, zone, arrival time, duration, and EV-only. "
          "The Recommend button scores all spots on the server and highlights the best "
          "match on the map. The booking form validates plate and phone format before "
          "submitting. Idempotency keys prevent a double booking if the form is "
          "submitted twice due to a slow network."),
        h2("3.2 Route-Based Parking Assistant"),
        p("The departure input accepts a full address or a 5-digit ZIP code. "
          "If the user enters a ZIP, the frontend appends the state and country before "
          "geocoding (e.g. 98006 becomes 98006, WA, USA). Address autocomplete shows "
          "Nominatim suggestions with a 320 ms debounce. Five ZIP chips are shown below "
          "the input for common Seattle-area locations."),
        h2("3.3 Analytics Dashboard"),
        p("The admin panel shows hourly booking counts and revenue by zone, "
          "a 6-step user funnel (search through check-out) with conversion rates, "
          "DAU/WAU/MAU counts, and a button to download all reservations as a CSV."),
        h2("3.4 Feature Flags"),
        p("Six feature flags are stored in the database and cached in memory for "
          "30 seconds. Admins can toggle them without restarting the server."),
        h2("3.5 Other UX Details"),
        p("Dark mode with localStorage persistence, an onboarding dialog shown once "
          "on first visit, QR code on checked-in booking cards, live countdown timers "
          "on pending and active reservations, and star ratings on completed bookings."),
    ]

    # ── 4. Algorithms
    story += [
        sp(6),
        h1("4. Key Algorithms"),
    ]
    algo_rows = [
        ["Algorithm", "Description"],
        ["Dynamic Pricing",
         "Price = pricePerHour × Dh × Bs.\n"
         "Dh = 24-point hourly demand curve, peaks at 8 AM and 5 PM (weekdays).\n"
         "Bs = deterministic per-spot hash offset in [0.75, 1.25].\n"
         "EV spaces carry a higher base pricePerHour set at seed time."],
        ["Surge Pricing",
         "If availableSpots / totalSpots < 0.30, apply 1.5× multiplier.\n"
         "Original price shown crossed out in the UI."],
        ["Recommendation Score",
         "score = 0.5·sprox + 0.3·savail + 0.2·scrowd\n"
         "sprox: degrades linearly from 1 (on-route ≤300 m) to 0 (2 km).\n"
         "savail: min(available/10, 1).\n"
         "scrowd: 1 − timeDemand × popularityFactor (lower crowd = better).\n"
         "Only spots with available > 0 included. Top-3 returned."],
        ["Expiry Cron",
         "Every 60 s: find PENDING reservations older than 5 min,\n"
         "set EXPIRED, restore counter via LEAST(available+1, total)."],
        ["Funnel Analytics",
         "6 events batched every 10 s (keepalive fetch on visibilitychange).\n"
         "Stored in FunnelEvent; 7-day conversion rates computed server-side."],
    ]
    atbl = Table(algo_rows, colWidths=[1.6*inch, 4.8*inch])
    atbl.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,0), TEAL),
        ("TEXTCOLOR",  (0,0), (-1,0), colors.white),
        ("FONTNAME",   (0,0), (-1,0), "Helvetica-Bold"),
        ("FONTSIZE",   (0,0), (-1,-1), 8.5),
        ("LEADING",    (0,0), (-1,-1), 12),
        ("ROWBACKGROUNDS", (0,1), (-1,-1), [colors.white, colors.HexColor("#f0fafa")]),
        ("GRID", (0,0), (-1,-1), 0.4, colors.HexColor("#b0dede")),
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("LEFTPADDING", (0,0), (-1,-1), 6),
        ("RIGHTPADDING", (0,0), (-1,-1), 6),
        ("TOPPADDING", (0,0), (-1,-1), 4),
        ("BOTTOMPADDING", (0,0), (-1,-1), 4),
    ]))
    story += [atbl, sp(8)]

    # ── 5. Limitations
    story += [
        h1("5. Limitations"),
    ]
    story += bullets([
        "<b>Simulated occupancy.</b> Availability numbers come from a cron-based simulator, "
        "not from real gate sensors. The trends look realistic but the counts do not "
        "match what is actually happening in any real lot.",
        "<b>Seattle only.</b> ZIP normalisation hard-codes the state as Washington. "
        "Deploying for a campus in another state would require changing that.",
        "<b>No real payments.</b> The checkout flow calculates a fee and stores it, but "
        "there is no integration with a payment processor.",
        "<b>In-process rate limiting.</b> Rate limit counters live in Node.js memory. "
        "Multiple server instances behind a load balancer would need Redis.",
        "<b>Simple session model.</b> Sessions are random tokens in the database with no "
        "expiry or revocation beyond deleting the row manually.",
        "<b>No accessibility audit.</b> The app has not been tested with a screen reader "
        "or run through an automated WCAG check.",
    ], numbered=True)

    # ── 6. Future Work
    story += [
        sp(8),
        h1("6. Future Work"),
    ]
    story += bullets([
        "Replace the simulator with actual gate/sensor data using a WebSocket "
        "connection so the availability counts are real.",
        "Add a payment step using Stripe so users are charged at checkout, with "
        "refunds handled automatically on cancellation.",
        "Build push notifications so users get reminded before their parking window "
        "starts or when their booking is about to expire.",
        "Support multiple campuses by making the geographic region configurable "
        "rather than hard-coded to Seattle.",
        "Add a permit tier so students with annual permits can book from a separate "
        "reserved pool before the general inventory opens.",
        "Do a proper accessibility pass — fix focus order, test with VoiceOver and "
        "NVDA, check colour contrast ratios.",
        "Use the FunnelEvent and SearchLog data to train a simple demand forecasting "
        "model that could warn admins before lots fill up.",
    ], numbered=True)

    # ── 7. Conclusion
    story += [
        sp(8),
        h1("7. Conclusion"),
        p("CampusPark ended up covering more ground than I initially planned. "
          "The core reservation workflow — search, book, check in, check out — "
          "works end to end, and the admin dashboard gives a decent view of what "
          "is happening in the system. The main things I would improve with more "
          "time are replacing the simulated data with real sources and adding "
          "proper payment handling."),
        p("Source code: https://github.com/sguanya-stack/campus-park"),
        sp(8),
        hr(),
        sp(4),
        h1("References"),
    ]
    refs = [
        "[1] OpenStreetMap contributors. Nominatim. https://nominatim.org/, accessed April 2026.",
        "[2] Project OSRM contributors. Open Source Routing Machine. https://project-osrm.org/, accessed April 2026.",
        "[3] Agafonkin, V. et al. Leaflet. https://leafletjs.com/, accessed April 2026.",
        "[4] Prisma Data, Inc. Prisma ORM. https://www.prisma.io/docs/, accessed April 2026.",
        "[5] Kelektiv. node-cron. https://github.com/kelektiv/node-cron, accessed April 2026.",
        "[6] Chart.js contributors. Chart.js. https://www.chartjs.org/, accessed April 2026.",
    ]
    for r in refs:
        story.append(Paragraph(r, bullet_style))

    doc.build(story, onFirstPage=_add_header_footer, onLaterPages=_add_header_footer)
    print(f"PDF generated: {OUTPUT}")

if __name__ == "__main__":
    build_doc()

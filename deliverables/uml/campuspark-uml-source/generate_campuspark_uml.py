#!/usr/bin/env python3
import json
import math
import zipfile
from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import landscape
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas


BASE_DIR = Path(__file__).resolve().parent
SPEC_PATH = BASE_DIR / "campuspark_uml_spec.json"
PDF_PATH = BASE_DIR / "campuspark-uml.pdf"
TXT_PATH = BASE_DIR / "description.txt"
ZIP_PATH = BASE_DIR / "campuspark-uml-source.zip"
PAGE_SIZE = landscape((1000, 760))


def load_spec():
    return json.loads(SPEC_PATH.read_text(encoding="utf-8"))


def wrap_line(text, font_name, font_size, max_width):
    words = text.split(" ")
    lines = []
    current = ""
    for word in words:
      candidate = word if not current else f"{current} {word}"
      if stringWidth(candidate, font_name, font_size) <= max_width:
        current = candidate
      else:
        if current:
          lines.append(current)
        current = word
    if current:
      lines.append(current)
    return lines or [text]


def draw_round_box(pdf, node):
    x, y, w, h = node["x"], node["y"], node["w"], node["h"]
    pdf.setFillColor(HexColor(node.get("fill", "#FFFFFF")))
    pdf.setStrokeColor(HexColor("#2F3B52"))
    pdf.setLineWidth(1.2)
    pdf.roundRect(x, y, w, h, 14, stroke=1, fill=1)

    pdf.setFillColor(HexColor("#1F2937"))
    pdf.setFont("Helvetica-Bold", 14)
    pdf.drawString(x + 12, y + h - 22, node["title"])

    pdf.setFont("Helvetica", 9.5)
    text_y = y + h - 40
    for raw_line in node.get("lines", []):
        wrapped = wrap_line(raw_line, "Helvetica", 9.5, w - 24)
        for line in wrapped:
            pdf.drawString(x + 12, text_y, f"- {line}")
            text_y -= 12


def box_center(node):
    return (node["x"] + node["w"] / 2, node["y"] + node["h"] / 2)


def edge_points(source, target):
    sx, sy = box_center(source)
    tx, ty = box_center(target)
    dx = tx - sx
    dy = ty - sy
    if abs(dx) >= abs(dy):
        start_x = source["x"] + (source["w"] if dx > 0 else 0)
        start_y = sy
        end_x = target["x"] + (0 if dx > 0 else target["w"])
        end_y = ty
    else:
        start_x = sx
        start_y = source["y"] + (source["h"] if dy > 0 else 0)
        end_x = tx
        end_y = target["y"] + (0 if dy > 0 else target["h"])
    return start_x, start_y, end_x, end_y


def draw_arrow(pdf, source, target, label):
    x1, y1, x2, y2 = edge_points(source, target)
    pdf.setStrokeColor(HexColor("#334155"))
    pdf.setFillColor(HexColor("#334155"))
    pdf.setLineWidth(1.1)
    pdf.line(x1, y1, x2, y2)

    angle = math.atan2(y2 - y1, x2 - x1)
    arrow_len = 8
    wing = math.pi / 7
    x3 = x2 - arrow_len * math.cos(angle - wing)
    y3 = y2 - arrow_len * math.sin(angle - wing)
    x4 = x2 - arrow_len * math.cos(angle + wing)
    y4 = y2 - arrow_len * math.sin(angle + wing)
    pdf.line(x2, y2, x3, y3)
    pdf.line(x2, y2, x4, y4)

    if not label:
        return

    mx = (x1 + x2) / 2
    my = (y1 + y2) / 2
    label_lines = label.split("\\n")
    label_width = max(stringWidth(line, "Helvetica", 8.5) for line in label_lines) + 10
    label_height = 12 * len(label_lines) + 4
    pdf.setFillColor(HexColor("#FFFFFF"))
    pdf.roundRect(mx - label_width / 2, my - label_height / 2, label_width, label_height, 6, stroke=0, fill=1)
    pdf.setFillColor(HexColor("#111827"))
    pdf.setFont("Helvetica", 8.5)
    ty = my + (len(label_lines) - 1) * 5
    for line in label_lines:
        pdf.drawCentredString(mx, ty, line)
        ty -= 10


def draw_footer(pdf, notes):
    x = 40
    y = 50
    w = 1310
    h = 80
    pdf.setFillColor(HexColor("#F8FAFC"))
    pdf.setStrokeColor(HexColor("#CBD5E1"))
    pdf.roundRect(x, y, w, h, 12, stroke=1, fill=1)
    pdf.setFillColor(HexColor("#0F172A"))
    pdf.setFont("Helvetica-Bold", 11)
    pdf.drawString(x + 14, y + h - 20, "Interaction Notes")
    pdf.setFont("Helvetica", 9.5)
    text_y = y + h - 38
    for note in notes:
        pdf.drawString(x + 18, text_y, f"- {note}")
        text_y -= 16


def build_pdf(spec):
    nodes = {node["id"]: node for node in spec["nodes"]}
    pdf = canvas.Canvas(str(PDF_PATH), pagesize=PAGE_SIZE)
    width, height = PAGE_SIZE

    pdf.setTitle(spec["title"])
    pdf.setAuthor("OpenAI Codex")
    pdf.setSubject("CampusPark UML component diagram")

    pdf.setFillColor(HexColor("#F1F5F9"))
    pdf.rect(0, 0, width, height, stroke=0, fill=1)

    pdf.setFillColor(HexColor("#0F172A"))
    pdf.setFont("Helvetica-Bold", 20)
    pdf.drawString(40, height - 36, spec["title"])
    pdf.setFont("Helvetica", 10)
    pdf.setFillColor(HexColor("#475569"))
    pdf.drawString(40, height - 54, spec["subtitle"])

    for node in spec["nodes"]:
        draw_round_box(pdf, node)

    for edge in spec["edges"]:
        draw_arrow(pdf, nodes[edge["from"]], nodes[edge["to"]], edge.get("label", ""))

    draw_footer(pdf, spec.get("notes", []))
    pdf.showPage()
    pdf.save()


def write_description():
    text = (
        "系统以浏览器端单页应用为入口，app.js 负责路由、筛选、地图渲染和预约流程，并通过 "
        "fetch 调用 server.js 提供的鉴权、车位、预约和统计接口。后端使用 Prisma 访问 "
        "PostgreSQL，管理用户、会话、车位、预约和搜索日志；定时任务周期性更新库存，"
        "PWA 与地图服务分别提供离线壳层和位置展示/导航能力。"
    )
    TXT_PATH.write_text(text + "\n", encoding="utf-8")


def build_zip():
    with zipfile.ZipFile(ZIP_PATH, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.write(SPEC_PATH, arcname=SPEC_PATH.name)
        zf.write(Path(__file__), arcname=Path(__file__).name)


def main():
    spec = load_spec()
    build_pdf(spec)
    write_description()
    build_zip()
    print(f"Generated {PDF_PATH.name}")
    print(f"Generated {TXT_PATH.name}")
    print(f"Generated {ZIP_PATH.name}")


if __name__ == "__main__":
    main()

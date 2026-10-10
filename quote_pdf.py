"""Preserve an imported original quote's artwork, fonts and layout."""
from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo
import os
from pathlib import Path

from quote_agent import format_money


def prepare_template(data, font_data=None):
    import fitz
    doc = fitz.open(stream=data, filetype="pdf")
    if len(doc) != 1:
        raise ValueError("Template needs a reviewed one-page quote")
    page = doc[0]
    spans = [s for b in page.get_text("dict", flags=fitz.TEXTFLAGS_DICT & ~fitz.TEXT_PRESERVE_IMAGES)["blocks"] if "lines" in b for l in b["lines"] for s in l["spans"]]
    by_text = {s["text"].strip(): s for s in spans}
    required = ("Offertnummer", "Kundnr", "Offertdatum", "Er referens", "Art.nr", "Beskrivning", "Antal", "Enhet", "Rabatt", "Summa", "Exkl. moms", "Avrundning", "Giltig t o m", "Planerat leveransdatum", "Totalbelopp")
    if any(k not in by_text for k in required):
        raise ValueError("Unsupported original template layout")
    layout = {"slots": {}, "columns": {}, "page": list(page.rect)}
    redactions = []
    for key in ("Offertnummer", "Kundnr", "Offertdatum", "Er referens", "Exkl. moms", "Avrundning", "Giltig t o m", "Planerat leveransdatum", "Totalbelopp"):
        label = by_text[key]
        values = [s for s in spans if s["bbox"][0] > label["bbox"][2] + 5 and abs(s["bbox"][1] - label["bbox"][1]) < 1]
        # Lower left/right totals share baselines; pick the nearest value.
        if not values: raise ValueError("Missing template field " + key)
        value = min(values, key=lambda s: s["bbox"][0])
        x0 = value["bbox"][0]
        x1 = 300 if key in ("Kundnr", "Offertdatum", "Er referens", "Exkl. moms", "Avrundning") else 550
        if key in ("Exkl. moms", "Avrundning"): x0 = 240
        if key == "Er referens": x1 = 550
        if key in ("Totalbelopp", "Giltig t o m", "Planerat leveransdatum"): x0 = max(label["bbox"][2] + 5, 428)
        rect = [x0, value["bbox"][1] - 0.2, x1, value["bbox"][3] + 3]
        layout["slots"][key] = rect
        b = value["bbox"]
        redactions.append([b[0], b[1] + 2, b[2], b[3] - 2])
    vat = next(s for s in spans if s["text"].startswith("Moms (") and s["bbox"][1] > by_text["Exkl. moms"]["bbox"][1])
    layout["slots"]["Moms"] = [240, vat["bbox"][1] - 0.2, 300, vat["bbox"][3] + 3]
    vat_value = next(s for s in spans if s["bbox"][0] > vat["bbox"][2] + 5 and abs(s["bbox"][1] - vat["bbox"][1]) < 1)
    b = vat_value["bbox"]
    redactions.append([b[0], b[1] + 2, b[2], b[3] - 2])
    # The customer rectangle is taken from the original document's drawing geometry.
    rectangles = [d["rect"] for d in page.get_drawings() if d["rect"].x0 > 250 and 70 < d["rect"].y0 < by_text["Kundnr"]["bbox"][1] and d["rect"].height > 20]
    if not rectangles: raise ValueError("Original customer box not identified")
    box = min(rectangles, key=lambda r: r.y0)
    layout["slots"]["customer"] = [box.x0 + 5, box.y0 + 6, box.x1 - 5, box.y1 - 4]
    top = by_text["Art.nr"]["bbox"][3] + 5
    bottom = min(by_text["Giltig t o m"]["bbox"][1], by_text["Exkl. moms"]["bbox"][1]) - 10
    layout["body"] = [by_text["Art.nr"]["bbox"][0] - 1, top, by_text["Summa"]["bbox"][2] + 1, bottom]
    for label in ("Art.nr", "Beskrivning", "Antal", "Enhet", "Rabatt", "Summa"):
        layout["columns"][label] = list(by_text[label]["bbox"])
    price = next(s for s in spans if s["text"].strip() in ("À-pris", "Á-pris", "A-pris"))
    layout["columns"]["price"] = list(price["bbox"])
    # Commercial fields belong to a particular offer, rather than the artwork.
    for key in ("Leveransvillkor", "Leveranssätt", "Bet villkor", "Dröjsmålsränta"):
        if key not in by_text: continue
        label = by_text[key]
        layout["slots"][key] = [136.66, label["bbox"][1] - 0.2, 300, label["bbox"][3] + 3]
    commercial_top = by_text["Leveransvillkor"]["bbox"][1]
    for span in spans:
        b = span["bbox"]
        if b[0] > 130 and commercial_top - 1 <= b[1] < by_text["Art.nr"]["bbox"][1] - 10:
            redactions.append([b[0], b[1] + 2, b[2], b[3] - 2])
    for rect in redactions + [layout["slots"]["customer"], layout["body"]]:
        page.add_redact_annot(fitz.Rect(rect), fill=False)
    page.apply_redactions(images=0, graphics=0)
    # Original PDFs embed a subset of Verdana. New customer names need the full
    # font, otherwise missing letters appear as squares. Embed it privately in
    # the template so Linux rendering needs no installed Windows fonts.
    if font_data is None:
        font_path = Path(os.getenv("QUOTE_AGENT_FONT_FILE", "C:/Windows/Fonts/verdana.ttf"))
        if not font_path.is_file(): raise ValueError("Full Verdana font required when preparing the original template")
        font_data = font_path.read_bytes()
    font = fitz.Font(fontbuffer=font_data)
    if any(not font.has_glyph(ord(c), fallback=False) for c in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789ÅÄÖåäö-@"):
        raise ValueError("Template font lacks required characters")
    page.insert_font(fontname="AgentRegular", fontbuffer=font_data)
    doc.set_metadata({})
    doc.del_xml_metadata()
    clean = doc.tobytes(garbage=4, deflate=True)
    doc.close()
    return clean, layout


def render_quote(data, layout, result, run_id):
    import fitz
    if not result.get("quote", {}).get("lines"):
        raise ValueError("No verified source rows")
    if result["quote"].get("tax_basis") not in (None, "inclusive"):
        raise ValueError("Originalmallen använder priser inklusive moms. Annan momsbas kräver Niclas granskning.")
    if result["quote"].get("tax_rate_percent", 25) != 25:
        raise ValueError("Originalmallen har 25 % moms. Export eller annan moms kräver Niclas granskning.")
    doc = fitz.open(stream=data, filetype="pdf")
    page = doc[0]
    for font in page.get_fonts():
        if font[4] == "AgentRegular":
            font_data = doc.extract_font(font[0])[3]
            if font_data:
                page.insert_font(fontname="AgentRegular", fontbuffer=font_data)
                break
    else: raise ValueError("Original quote font is unavailable")

    def write(rect, text, align=0, size=8):
        if page.insert_textbox(fitz.Rect(rect), str(text), fontname="AgentRegular", fontsize=size, align=align) < 0:
            raise ValueError("Offerttext ryms inte i originalmallen; manuell granskning behövs")

    customer = result["customer"]
    slots = layout["slots"]
    write(slots["Offertnummer"], "UTKAST-" + run_id[-6:].upper())
    write(slots["Kundnr"], "Ej tilldelat")
    write(slots["Offertdatum"], datetime.now(ZoneInfo("Europe/Stockholm")).date().isoformat())
    write(slots["Er referens"], " ".join(filter(None, [customer.get("phone"), customer.get("email")])) )
    for key in ("Leveransvillkor", "Leveranssätt", "Bet villkor", "Dröjsmålsränta"):
        if key in slots: write(slots[key], "Bekräftas")
    address = "\n".join(filter(None, [customer.get("name"), customer.get("address"), " ".join(filter(None, [customer.get("postal_code"), customer.get("city")]))]))
    write(slots["customer"], address)
    quote = result["quote"]
    for key, value in (("Exkl. moms", quote["subtotal_ex_vat_sek"]), ("Moms", quote["vat_sek"]), ("Avrundning", quote["rounding_sek"])):
        write(slots[key], format_money(value), 2)
    write(slots["Totalbelopp"], format_money(quote["total_sek"]) + " SEK", 2, 10)
    write(slots["Giltig t o m"], "Bekräftas", 2)
    write(slots["Planerat leveransdatum"], "Bekräftas", 2)
    cols = layout["columns"]
    y = layout["body"][1] + 3
    for line in quote["lines"]:
        desc = line["description"]
        width = cols["Antal"][0] - cols["Beskrivning"][0] - 8
        font = fitz.Font(fontbuffer=font_data)
        words, wrapped, current = desc.split(), [], ""
        for word in words:
            candidate = (current + " " + word).strip()
            if font.text_length(candidate, fontsize=8) > width:
                if not current: raise ValueError("Article description cannot fit the template")
                wrapped.append(current)
                current = word
            else: current = candidate
        if current: wrapped.append(current)
        height = max(1, len(wrapped)) * 11 + 6
        if y + height > layout["body"][3] - 45: raise ValueError("Quote has more rows than original template capacity")
        def cell(x0, x1, value, align=0): write([x0, y, x1, y + height], value, align)
        cell(cols["Art.nr"][0], cols["Beskrivning"][0] - 5, line["article_number"])
        cell(cols["Beskrivning"][0], cols["Antal"][0] - 5, "\n".join(wrapped))
        cell(cols["Antal"][0] - 5, cols["Antal"][2] + 1, format_money(line["quantity"]), 2)
        cell(cols["Enhet"][0], cols["price"][0] - 32, line["unit"])
        cell(cols["price"][0] - 34, cols["price"][2] + 1, format_money(line["unit_price_sek"]), 2)
        cell(cols["Rabatt"][0] - 5, cols["Rabatt"][2] + 1, format_money(line["discount_percent"]) + "%" if line["discount_percent"] else "", 2)
        cell(cols["Summa"][0] - 14, cols["Summa"][2] + 1, format_money(line["sum_sek"]), 2)
        y += height
    write([layout["body"][0] + 5, y + 10, layout["body"][2] - 5, layout["body"][3]],
          "UTKAST - historiskt offertunderlag.\nPriser, rabatt, frakt och villkor ska bekräftas av Niclas.\nLeverans och giltighet är inte fastställda.")
    page.insert_text((315, 85), "UTKAST - ej godkänd offert", fontsize=8, color=(0.7, 0.12, 0.12))
    output = doc.tobytes(garbage=4, deflate=True)
    doc.close()
    return output

"""Import a private Gmail export plus downloaded PDFs. No email is sent.

Usage: python import_quote_archive.py DIRECTORY [--base-url https://...]
The export contains mails-*.json with the connector's original message IDs,
headers and text, and pdfs/<message-id>-<filename>.pdf. Never commit the export.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path

import requests


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path)
    parser.add_argument("--base-url")
    parser.add_argument("--template", default="Offert5333.pdf")
    args = parser.parse_args()
    messages = [m for path in sorted(args.directory.glob("mails-*.json")) for m in json.loads(path.read_text(encoding="utf-8"))]
    if not messages: raise SystemExit("No archive messages")
    import admin_api_flask as app
    pdfs = []
    for message in messages:
        for attachment in message.get("attachments", []):
            path = args.directory / "pdfs" / (message["id"] + "-" + attachment["filename"])
            if not path.exists(): raise SystemExit("Missing attachment: " + path.name)
            pdfs.append(("gmail:" + message["id"], attachment["filename"], path.read_bytes()))
    template = next((blob for _, name, blob in pdfs if name == args.template), None)
    if not template: raise SystemExit("Original template PDF not found")
    asset_id = "pdf:" + hashlib.sha256(template).hexdigest()
    if args.base_url:
        base = args.base_url.rstrip("/")
        headers = {"X-Admin-Key": os.environ["ADMIN_API_KEY"]}
        result = requests.post(base + "/api/quote_agent/history/import", headers=headers, json={"messages": messages}, timeout=90)
        result.raise_for_status()
        print("Imported", len(messages), "emails")
        for i, (source_id, filename, blob) in enumerate(pdfs):
            response = requests.post(base + "/api/quote_agent/history/import", headers=headers,
                                     data={"source_id": source_id}, files={"file": (filename, blob, "application/pdf")}, timeout=60)
            response.raise_for_status()
            if i % 30 == 0: print("PDF progress", i + 1, "/", len(pdfs), flush=True)
        font_path = Path(os.getenv("QUOTE_AGENT_FONT_FILE", "C:/Windows/Fonts/verdana.ttf"))
        response = requests.post(base + "/api/quote_agent/template", headers=headers,
                                 json={"asset_id": asset_id, "font_base64": base64.b64encode(font_path.read_bytes()).decode()}, timeout=60)
        response.raise_for_status()
        print("Original template registered")
    else:
        db = app.get_db()
        if not db: raise SystemExit("Database unavailable")
        try:
            print(app.quote_agent.import_history(db, app.QUOTE_AGENT_MODELS, messages, pdfs))
            data, layout = app.quote_pdf.prepare_template(template)
            template_id = "template:" + hashlib.sha256(data).hexdigest()
            db.merge(app.QuoteAsset(id=template_id, history_id="gmail:" + next(m["id"] for m in messages if any(a["filename"] == args.template for a in m.get("attachments", []))),
                                    filename="Niclas-originalmall.pdf", data=data, extracted={"layout": layout, "source_asset_id": asset_id}))
            db.commit()
            if not app.set_site_content("quote_agent_template", template_id): raise SystemExit("Template not persisted")
            print("Original template registered")
        finally: db.close()


if __name__ == "__main__": main()

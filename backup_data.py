#!/usr/bin/env python3
"""
Read-only backup of the production database.

Uploaded images live only in the database (the disk copy on Render is wiped
on every redeploy), so a lost row cannot be restored from git. Run this
before touching content, and on a schedule:

    python backup_data.py                 # writes ../henricssons-backups/backup-<timestamp>
    python backup_data.py C:\\backups      # or into a directory you pick

Every table goes to tables/<table>.json and every stored blob to
files/<table>/<name>, so an image can be re-uploaded straight from the
backup. Nothing is ever written to the database.
"""

import datetime
import json
import os
import re
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_BACKUP_ROOT = BASE_DIR.parent / "henricssons-backups"

# table -> (name column, blob column, mime column)
BLOB_TABLES = {
    "site_images": ("rel_path", "data", "mime"),
    "temp_product_images": ("filename", "data", "mime"),
    "boat_brand_images": ("filename", "data", "mime"),
    "submission_attachments": ("filename", "data", "mime"),
}

MIME_EXTS = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "application/pdf": ".pdf"}


def load_database_url() -> str:
    url = os.environ.get("DATABASE_URL", "").strip()
    if url:
        return url
    env_file = BASE_DIR / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith("DATABASE_URL"):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("DATABASE_URL is not set (environment or .env)")


def json_default(value):
    if isinstance(value, (datetime.datetime, datetime.date)):
        return value.isoformat()
    if isinstance(value, (bytes, bytearray, memoryview)):
        return {"__bytes_len__": len(bytes(value))}
    return str(value)


def safe_relative(name: str, fallback: str) -> Path:
    cleaned = re.sub(r"[^A-Za-z0-9._/-]", "_", str(name or "").replace("\\", "/").strip("/"))
    parts = [part for part in cleaned.split("/") if part not in ("", ".", "..")]
    return Path(*parts) if parts else Path(fallback)


def dump_blob(record, out_dir, table, name_col, data_col, mime_col, index):
    raw = bytes(record[data_col])
    label = str(record.get(name_col) or f"{table}-{record.get('id', index)}")
    rel = safe_relative(label, f"{table}-{index}")
    if not rel.suffix:
        rel = rel.with_suffix(MIME_EXTS.get(str(record.get(mime_col) or ""), ".bin"))
    target = out_dir / "files" / table / rel
    if target.exists():
        target = target.with_name(f"{target.stem}__id{record.get('id', index)}{target.suffix}")
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
    except OSError:
        # Windows still caps paths at 260 characters for most tools; a long
        # original filename must not cost us the backup of that image.
        target = out_dir / "files" / table / f"{record.get('id', index)}{rel.suffix}"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
    return {
        "__file__": str(target.relative_to(out_dir)).replace("\\", "/"),
        "original_name": label,
        "bytes": len(raw),
    }


def main() -> None:
    try:
        import psycopg2
    except ImportError:
        raise SystemExit("psycopg2 is required: pip install psycopg2-binary")

    backup_root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else DEFAULT_BACKUP_ROOT
    out_dir = backup_root / f"backup-{datetime.datetime.now():%Y%m%d-%H%M%S}"
    (out_dir / "tables").mkdir(parents=True, exist_ok=True)

    conn = psycopg2.connect(load_database_url())
    conn.set_session(readonly=True, autocommit=True)
    cur = conn.cursor()

    cur.execute(
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_schema = 'public' ORDER BY table_name"
    )
    tables = [row[0] for row in cur.fetchall()]
    summary = {"created": out_dir.name, "tables": {}, "files": 0, "bytes": 0}

    for table in tables:
        cur.execute(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_schema='public' AND table_name=%s ORDER BY ordinal_position",
            (table,),
        )
        columns = [row[0] for row in cur.fetchall()]
        cur.execute(f'SELECT * FROM "{table}"')
        records = [dict(zip(columns, row)) for row in cur.fetchall()]

        name_col, data_col, mime_col = BLOB_TABLES.get(table, (None, None, None))
        if data_col and data_col in columns:
            for index, record in enumerate(records):
                if record.get(data_col) is None:
                    continue
                info = dump_blob(record, out_dir, table, name_col, data_col, mime_col, index)
                record[data_col] = info
                summary["files"] += 1
                summary["bytes"] += info["bytes"]

        with (out_dir / "tables" / f"{table}.json").open("w", encoding="utf-8") as handle:
            json.dump(records, handle, ensure_ascii=False, indent=2, default=json_default)
        summary["tables"][table] = len(records)
        print(f"{table}: {len(records)} rows")

    # site_content holds models_meta and the page texts; keep them as plain
    # JSON too so they can be inspected without unwrapping the table dump.
    cur.execute("SELECT key, data FROM site_content")
    for key, data in cur.fetchall():
        with (out_dir / f"site_content-{safe_relative(key, 'key')}.json").open("w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2, default=json_default)

    with (out_dir / "SUMMARY.json").open("w", encoding="utf-8") as handle:
        json.dump(summary, handle, ensure_ascii=False, indent=2)

    cur.close()
    conn.close()
    print(f"\nBackup written to {out_dir}")
    print(f"{summary['files']} files, {summary['bytes'] / 1024 / 1024:.1f} MB")


if __name__ == "__main__":
    main()

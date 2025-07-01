#!/usr/bin/env python3
"""
reset_examples.py
-----------------
1. Tar bort gamla poster:
   • raderar hela katalogen assets/model_images/
   • skriver över examples_meta.json med endast de data som finns i henricssons_bilder/models_meta.json
2. Kopierar in alla bilder från henricssons_bilder/ till assets/model_images/ och uppdaterar paths.

Kör:
    python reset_examples.py
"""
import shutil, pathlib, json, re, textwrap, datetime
from unidecode import unidecode

ROOT = pathlib.Path(__file__).parent.resolve()
SCRAPED = ROOT / "henricssons_bilder"
MODELS_META = SCRAPED / "models_meta.json"
ASSETS_DIR = ROOT / "assets" / "model_images"
OUT_META = ROOT / "examples_meta.json"

slug_re = re.compile(r"[^a-z0-9]+")

def slugify(txt: str) -> str:
    return slug_re.sub("-", unidecode(txt.lower())).strip("-")

# 1. Rensa gammalt -------------------------------------------------------------
if ASSETS_DIR.exists():
    shutil.rmtree(ASSETS_DIR)
ASSETS_DIR.mkdir(parents=True, exist_ok=True)
print("✓ Gamla assets/model_images raderade.")

# 2. Läs scraped metadata ------------------------------------------------------
models = json.loads(MODELS_META.read_text(encoding="utf-8"))

new_meta = {}

for slug, data in models.items():
    manuf = data["manufacturer"].strip()
    model = data["model"].strip()
    if not manuf and not model:
        continue

    key = f"{slugify(manuf)}::{slugify(model or slug)}"

    # kopiera bilder
    dest_folder = ASSETS_DIR / slugify(model or slug)
    dest_folder.mkdir(parents=True, exist_ok=True)

    rel_paths = []
    for rel in data["images"]:
        src_path = SCRAPED / rel
        if not src_path.exists():
            continue
        dest_path = dest_folder / src_path.name
        if not dest_path.exists():
            shutil.copy2(src_path, dest_path)
        rel_paths.append(str(dest_path.relative_to(ROOT)))

    if not rel_paths:
        continue

    new_meta[key] = {
        "manufacturer": manuf,
        "model": model,
        "images": rel_paths
    }

print(f"✓ Kopierade bilder för {len(new_meta)} modeller.")

# 3. Skriv nytt examples_meta.json --------------------------------------------
OUT_META.write_text(json.dumps(new_meta, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"✓ examples_meta.json ersatt (totalt {len(new_meta)} poster).")

# -- Steg 4 borttaget --
# Vi ändrar INTE längre kapellforfragan_full.js, eftersom tillverkare och modeller
# inte ska påverkas av exempelbilderna.
# Om du behöver uppdatera boatData, gör det manuellt i den filen. 
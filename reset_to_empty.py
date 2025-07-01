#!/usr/bin/env python3
"""
reset_to_empty.py
-----------------
Clears all example images and related metadata so that the gallery "Bilder & exempel" shows nothing, while keeping the existing boatData manufacturers
and model names intact for use in Kapellförfrågan and the admin panel.

What the script does:
1. Remove the entire assets/model_images/ directory and recreate it empty.
2. Overwrite examples_meta.json with an empty object {}
3. Overwrite extras_data.json with default empty category lists
4. Strip all "images" arrays inside kapellforfragan_full.js, replacing them with empty arrays [] so boatData still contains all manufacturers/models but no images.

Run:
    python reset_to_empty.py
"""
import pathlib, shutil, json, re, datetime, sys

ROOT = pathlib.Path(__file__).parent.resolve()
ASSETS = ROOT / "assets" / "model_images"
EXAMPLES_META = ROOT / "examples_meta.json"
EXTRAS_DATA = ROOT / "extras_data.json"
KAP_FILE = ROOT / "kapellforfragan_full.js"

# 1. Delete assets/model_images
if ASSETS.exists():
    shutil.rmtree(ASSETS)
ASSETS.mkdir(parents=True, exist_ok=True)
print("✓ Tömde assets/model_images/")

# 2. Empty examples_meta.json
EXAMPLES_META.write_text("{}\n", encoding="utf-8")
print("✓ Nollställde examples_meta.json")

# 3. Empty extras_data.json (keep category keys)
empty_extras = {"boatseats": [], "otherfabrics": [], "special": [], "sunbrella": []}
EXTRAS_DATA.write_text(json.dumps(empty_extras, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("✓ Nollställde extras_data.json")

# 4. Strip images arrays in kapellforfragan_full.js
src = KAP_FILE.read_text(encoding="utf-8")
# Replace any "images": [ ... ] (non-greedy up to closing ]) with empty list
cleaned = re.sub(r'"images"\s*:\s*\[[^\]]*?\]', '"images": []', src, flags=re.S)
# If nothing replaced, let user know
if src != cleaned:
    KAP_FILE.write_text(cleaned + f"\n// images cleared {datetime.datetime.now().isoformat()}\n", encoding="utf-8")
    print("✓ Rensade bilder ur kapellforfragan_full.js")
else:
    print("⚠️  Hittade inga images-arrayer att rensa i kapellforfragan_full.js")

print("✓ Klart – galleriet är nu tömt men tillverkare & modeller kvar.") 
#!/usr/bin/env python3
"""
Kopierar nedladdade bilder från henricssons_bilder/ in i webbplatsens
assets/model_images/   och uppdaterar examples_meta.json så att nya
modeller visas i "Bilder & exempel" och adminpanelen.

Kör:
    python integrate_to_site.py
"""
import json, shutil, pathlib, re
from unidecode import unidecode

ROOT = pathlib.Path(__file__).parent.resolve()
SCRAPED = ROOT / "henricssons_bilder"
ASSETS = ROOT / "assets" / "model_images"
META_PATH = ROOT / "examples_meta.json"
EXTRAS_PATH = ROOT / "extras_data.json"

# Hjälp-funktioner ------------------------------------------------------------
slug_re = re.compile(r"[^a-z0-9]+")

def slugify(txt: str) -> str:
    return slug_re.sub("-", unidecode(txt.lower())).strip("-")

def load_scraped_meta():
    path = SCRAPED / "models_meta.json"
    return json.loads(path.read_text(encoding="utf-8"))

# Läs befintligt examples_meta -------------------------------------------------
if META_PATH.exists():
    examples = json.loads(META_PATH.read_text(encoding="utf-8"))
else:
    examples = {}

# Ladda befintliga extras_data eller skapa tomt
if EXTRAS_PATH.exists():
    extras = json.loads(EXTRAS_PATH.read_text(encoding="utf-8"))
else:
    extras = {"motorboats":[], "sailboats":[], "boatseats":[], "otherfabrics":[], "special":[], "sunbrella":[]}

scraped = load_scraped_meta()

new_added = 0
for slug, data in scraped.items():
    manuf = data["manufacturer"].strip()
    model = data["model"].strip()
    if not manuf and not model:
        continue
    model_slug = slugify(model or slug)
    key = f"{slugify(manuf)}::{model_slug}"
    already_in_examples = key in examples
    if already_in_examples and examples[key].get("images"):
        # Behåll befintligt men komplettera extras nedan
        pass

    # kopiera bilder om behövs ----------------------------------------------
    copied_paths = []
    if already_in_examples:
        copied_paths = examples[key].get("images", [])
    else:
        src_folder = SCRAPED / slugify(data["category"]) / slug
        dest_folder = ASSETS / model_slug
        dest_folder.mkdir(parents=True, exist_ok=True)

        for img in data["images"]:
            src_path = SCRAPED / img  # relativ till SCRAPED
            if not src_path.exists():
                continue
            dest_path = dest_folder / src_path.name
            if not dest_path.exists():
                shutil.copy2(src_path, dest_path)
            copied_paths.append(str(dest_path.relative_to(ROOT)))

    if not copied_paths:
        continue

    examples[key] = {
        "manufacturer": manuf,
        "model": model,
        "images": copied_paths
    }

    # Lägg även till i extras enligt kategori
    cat_raw = data.get("category","Motorbåtar").lower()
    if "segel" in cat_raw:
        target = "sailboats"
    elif "motor" in cat_raw:
        target = "motorboats"
    elif "stol" in cat_raw or "dyn" in cat_raw:
        target = "boatseats"
    elif "vavprover" in cat_raw or "fargprover" in cat_raw:
        target = "otherfabrics"
    elif "special" in cat_raw or "skraddarsytt" in cat_raw:
        target = "special"
    elif "sunbrella" in cat_raw:
        target = "sunbrella"
    else:
        target = "motorboats"  # fallback
    lst = extras.setdefault(target, [])
    display_name = f"{manuf} {model}".strip()
    # hitta ev befintlig post för samma modell+manu
    existing = next((it for it in lst if it.get("manufacturer") == manuf and it.get("model") == model), None)
    if existing:
        # uppdatera bilder om tomt eller färre
        if copied_paths and (not existing.get("images") or len(existing["images"]) < len(copied_paths)):
            existing["images"] = copied_paths
        # uppdatera textfält om de saknas
        for fld in ("variant","description","delivery"):
            if not existing.get(fld) and data.get(fld):
                existing[fld] = data.get(fld, "")
        existing["name"] = display_name
    else:
        lst.append({
            "name": display_name,
            "manufacturer": manuf,
            "model": model,
            "variant": data.get("variant",""),
            "description": data.get("description",""),
            "delivery": data.get("delivery",""),
            "images": copied_paths
        })

    new_added += 1

# skriv tillbaka --------------------------------------------------------------
META_PATH.write_text(json.dumps(examples, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"✓ Integrerat {new_added} nya modeller. examples_meta.json uppdaterad.")

# Spara extras_data.json
EXTRAS_PATH.write_text(json.dumps(extras, ensure_ascii=False, indent=2), encoding="utf-8")
print("✓ extras_data.json uppdaterad med Motorbåtar och Segelbåtar.")

def key_to_slug(key: str) -> str:
    """Convert examples_meta.json key to website slug"""
    # Remove manufacturer:: prefix and convert to slug format
    if '::' in key:
        _, slug_part = key.split('::', 1)
    else:
        slug_part = key
    
    # Convert to lowercase and replace spaces/special chars with hyphens
    slug = re.sub(r'[^a-z0-9]+', '-', unidecode(slug_part.lower())).strip('-')
    return slug

def canon(label: str) -> str:
    """Categorize based on manufacturer/model"""
    l_raw = label or ""
    l = unidecode(l_raw).lower()
    if any(k in l for k in ("motorbat", "motorbatar")):
        return "Motorbåtar"
    if any(k in l for k in ("segelbat", "segelbatar")):
        return "Segelbåtar"
    if "sunbrella" in l:
        return "Sunbrella Plus Kollektion vävprover"
    if "special" in l or "skraddarsytt" in l:
        return "Specialsömnad & Skräddarsytt"
    if "vavprover" in l or "fargprover" in l:
        return "Vävprover övriga"
    if any(k in l for k in ("stol", "stolar", "dyna", "dynor")):
        return "Båtstolar & Dynor"
    return "Okategoriserad"

def main():
    print("🔄 Integrating examples_meta.json data into models_meta.json format...")
    
    # Load examples_meta.json
    examples_file = pathlib.Path("examples_meta.json")
    if not examples_file.exists():
        print("❌ examples_meta.json not found!")
        return
    
    with open(examples_file, 'r', encoding='utf-8') as f:
        examples = json.load(f)
    
    print(f"📊 Found {len(examples)} entries in examples_meta.json")
    
    # Convert to models_meta.json format
    models_meta = {}
    
    for key, data in examples.items():
        slug = key_to_slug(key)
        
        # Determine category based on manufacturer
        manufacturer = data.get("manufacturer", "")
        category = canon(manufacturer)
        
        # Convert image paths to the expected format
        images = []
        for img_path in data.get("images", []):
            # Convert from assets/model_images/... to category/slug/... format
            if img_path.startswith("assets\\model_images\\"):
                # Extract the filename
                filename = pathlib.Path(img_path).name
                # Create new path in category/slug format
                new_path = f"{category.lower().replace(' ', '-')}\\{slug}\\{filename}"
                images.append(new_path)
            else:
                # Keep original path if it doesn't match expected format
                images.append(img_path)
        
        models_meta[slug] = {
            "manufacturer": data.get("manufacturer", ""),
            "model": data.get("model", ""),
            "description": data.get("description", ""),
            "variant": data.get("variant", ""),
            "delivery": data.get("delivery", ""),
            "category": category,
            "images": images,
            "source": data.get("source", f"https://www.henricssonsbatkapell.se/exempel/{slug}")
        }
    
    # Save to models_meta.json
    models_meta_file = pathlib.Path("henricssons_bilder/models_meta.json")
    models_meta_file.parent.mkdir(exist_ok=True)
    
    with open(models_meta_file, 'w', encoding='utf-8') as f:
        json.dump(models_meta, f, indent=2, ensure_ascii=False)
    
    print(f"✅ Successfully created models_meta.json with {len(models_meta)} entries")
    
    # Show some statistics
    categories = {}
    for entry in models_meta.values():
        cat = entry["category"]
        categories[cat] = categories.get(cat, 0) + 1
    
    print(f"\n📈 Category breakdown:")
    for cat, count in sorted(categories.items()):
        print(f"  {cat}: {count} entries")
    
    # Show some examples
    print(f"\n🔍 Sample entries:")
    for i, (slug, data) in enumerate(list(models_meta.items())[:5]):
        print(f"  {slug}:")
        print(f"    Manufacturer: {data['manufacturer']}")
        print(f"    Model: {data['model']}")
        print(f"    Category: {data['category']}")
        print(f"    Description: {data['description'][:100]}{'...' if len(data['description']) > 100 else ''}")
        print(f"    Variant: {data['variant']}")
        print(f"    Delivery: {data['delivery']}")
        print(f"    Images: {len(data['images'])} images")
        print()

if __name__ == "__main__":
    main() 
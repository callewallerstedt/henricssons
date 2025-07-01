#!/usr/bin/env python3
"""
Script to convert the updated examples_meta.json data to models_meta.json format
"""

import json
import pathlib
import re
from unidecode import unidecode

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
    print("🔄 Converting examples_meta.json data to models_meta.json format...")
    
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
#!/usr/bin/env python3
"""
Script to fix categories in models_meta.json
"""

import json
import pathlib
from unidecode import unidecode

def get_better_category(manufacturer: str, model: str, description: str = "") -> str:
    """Better categorization based on manufacturer and model"""
    
    # Combine all text for analysis
    text = f"{manufacturer} {model} {description}".lower()
    text = unidecode(text)
    
    # Båtstolar & Dynor
    if any(word in text for word in ["batstol", "stol", "dyna", "dynor", "va-", "elite", "royalita"]):
        return "Båtstolar & Dynor"
    
    # Sunbrella Plus Kollektion vävprover
    if any(word in text for word in ["sunbrella", "vavprover", "fargprover", "recasens", "recsystem"]):
        return "Sunbrella Plus Kollektion vävprover"
    
    # Specialsömnad & Skräddarsytt
    if any(word in text for word in ["special", "skraddarsytt", "custom", "tillverkad", "tillverkat"]):
        return "Specialsömnad & Skräddarsytt"
    
    # Vävprover övriga
    if any(word in text for word in ["vavprover", "fargprover", "prover"]):
        return "Vävprover övriga"
    
    # Segelbåtar - kända segelbåtstillverkare
    segelbatar = [
        "albin", "hallberg-rassy", "hr", "scanmar", "maxi", "saga", "shipman", 
        "silje", "nimbus", "ryds", "scand", "seastar", "sefyr", "windy", "wings"
    ]
    
    if any(tillverkare in text for tillverkare in segelbatar):
        return "Segelbåtar"
    
    # Motorbåtar - alla andra (majoriteten)
    # Kända motorbåtstillverkare
    motorbatar = [
        "amt", "adec", "aquador", "finnmaster", "flipper", "uttern", "yamarin",
        "monark", "crescent", "grandezza", "jeanneau", "ornvik", "quicksilver",
        "micore", "mv-marin", "nora", "ockelbo", "polar", "rana", "risor",
        "skilso", "silver", "terhi", "tresfjord", "virbosnipa", "westkap",
        "xo", "viksund", "hansvik", "henajulle", "if", "hydrolift", "jofa",
        "hansen-protection", "kmw", "kmv", "joda", "lm", "mamba", "marex",
        "markilux", "maxim", "nidelv", "oe-olle-enderlein", "originalkapell"
    ]
    
    if any(tillverkare in text for tillverkare in motorbatar):
        return "Motorbåtar"
    
    # Om tillverkaren är tom eller okänd, gissa baserat på modellnamn
    if not manufacturer or manufacturer.strip() == "":
        # Kolla om modellnamnet innehåller typiska båtmodeller
        model_lower = model.lower()
        if any(word in model_lower for word in ["ht", "dc", "br", "cc", "wa", "targa", "cruiser"]):
            return "Motorbåtar"
        if any(word in model_lower for word in ["cirrus", "cumulus", "sprayhood"]):
            return "Segelbåtar"
    
    # Som standard, anta motorbåt (majoriteten av båtar)
    return "Motorbåtar"

def main():
    print("🔧 Fixing categories in models_meta.json...")
    
    # Load models_meta.json
    meta_file = pathlib.Path("henricssons_bilder/models_meta.json")
    if not meta_file.exists():
        print("❌ models_meta.json not found!")
        return
    
    with open(meta_file, 'r', encoding='utf-8') as f:
        meta = json.load(f)
    
    print(f"📊 Found {len(meta)} entries to process")
    
    # Fix categories
    updated_count = 0
    for slug, data in meta.items():
        old_category = data.get("category", "")
        new_category = get_better_category(
            data.get("manufacturer", ""),
            data.get("model", ""),
            data.get("description", "")
        )
        
        if old_category != new_category:
            data["category"] = new_category
            updated_count += 1
            print(f"  ✅ {slug}: {old_category} -> {new_category}")
    
    # Save updated meta data
    print(f"\n💾 Saving updated models_meta.json...")
    with open(meta_file, 'w', encoding='utf-8') as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)
    
    # Show statistics
    categories = {}
    for entry in meta.values():
        cat = entry["category"]
        categories[cat] = categories.get(cat, 0) + 1
    
    print(f"\n📈 Category breakdown:")
    for cat, count in sorted(categories.items()):
        print(f"  {cat}: {count} entries")
    
    print(f"\n✅ Done! Updated {updated_count} entries")

if __name__ == "__main__":
    main() 
#!/usr/bin/env python3
"""
Script to scrape categories from henricssonsbatkapell.se instead of guessing them
"""

import json
import pathlib
import requests
import bs4
import time
from unidecode import unidecode

def canon(label: str) -> str:
    """Convert scraped category label to standardized category name"""
    if not label:
        return "Okategoriserad"
    
    # Normalisera: ASCII-lowercase utan diakritiska tecken för robust matchning
    l = unidecode(label).lower()
    
    # Motorbåtar
    if any(key in l for key in ("motorbat", "motorbatar")):
        return "Motorbåtar"
    # Segelbåtar
    if any(key in l for key in ("segelbat", "segelbatar")):
        return "Segelbåtar"
    # Sunbrella Plus-kollektion
    if "sunbrella" in l:
        return "Sunbrella Plus Kollektion vävprover"
    # Specialsömnad & Skräddarsytt
    if "special" in l or "skraddarsytt" in l:
        return "Specialsömnad & Skräddarsytt"
    # Vävprover övriga / Färgprover
    if "vavprover" in l or "fargprover" in l:
        return "Vävprover övriga"
    # Båtstolar & Dynor
    if any(key in l for key in ("stol", "stolar", "dyna", "dynor", "batstol")):
        return "Båtstolar & Dynor"
    
    return "Okategoriserad"

def main():
    print("🔧 Scraping categories from henricssonsbatkapell.se...")
    
    # Load models_meta.json
    meta_file = pathlib.Path("henricssons_bilder/models_meta.json")
    if not meta_file.exists():
        print("❌ models_meta.json not found!")
        return
    
    with open(meta_file, 'r', encoding='utf-8') as f:
        meta = json.load(f)
    
    print(f"📊 Found {len(meta)} entries to process")
    
    # Setup session
    sess = requests.Session()
    sess.headers["User-Agent"] = "HenricssonsScraper/5.1"
    
    # Scrape categories from each page
    updated_count = 0
    for i, (slug, data) in enumerate(meta.items()):
        source_url = data.get("source", "")
        if not source_url:
            print(f"  ⚠️  {slug}: No source URL")
            continue
        
        try:
            print(f"  🔍 [{i+1}/{len(meta)}] Scraping {slug}...")
            
            # Get the page
            resp = sess.get(source_url, timeout=20)
            resp.encoding = 'utf-8'
            soup = bs4.BeautifulSoup(resp.text, 'html.parser')
            
            # Find category label
            cat_el = soup.select_one('.category-label')
            if cat_el:
                scraped_category = cat_el.get_text(strip=True)
                standardized_category = canon(scraped_category)
                
                old_category = data.get("category", "")
                if old_category != standardized_category:
                    data["category"] = standardized_category
                    updated_count += 1
                    print(f"    ✅ {slug}: '{scraped_category}' -> {standardized_category}")
                else:
                    print(f"    ✓ {slug}: '{scraped_category}' (unchanged)")
            else:
                print(f"    ⚠️  {slug}: No category label found")
            
            # Be nice to the server
            time.sleep(0.5)
            
        except Exception as e:
            print(f"    ❌ {slug}: Error - {e}")
            continue
    
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
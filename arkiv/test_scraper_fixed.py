#!/usr/bin/env python3
"""
Fixed version of the Henricssons scraper with proper encoding and label cleaning
"""

import re, json, pathlib, urllib.parse, concurrent.futures, requests, bs4
from unidecode import unidecode

BASE     = "https://www.henricssonsbatkapell.se"
START    = f"{BASE}/bilder-och-exempel"
ROOTDIR  = pathlib.Path("henricssons_bilder")
THREADS  = 4  # Reduced for testing

sess = requests.Session()
sess.headers["User-Agent"] = "HenricssonsScraper/5.1"

slug_re = re.compile(r"^/exempel/([a-z0-9\-]+)$", re.I)

# ── kategorimappning ────────────────────────────────────────────────────────
def canon(label: str) -> str:
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

def slugify(txt: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", unidecode(txt.lower())).strip("-") or "okategoriserad"

def clean_label(label: str) -> str:
    """Clean and normalize label text"""
    # Remove extra whitespace and normalize
    clean = re.sub(r'\s+', ' ', label).strip()
    clean = clean.lower()
    
    # Remove trailing colon if present
    if clean.endswith(':'):
        clean = clean[:-1]
    
    return clean

print("⏳ Hämtar gallerier …")

# ── hämta index & slug → kategori ───────────────────────────────────────────
try:
    index_response = sess.get(START, timeout=20)
    index_response.encoding = 'utf-8'  # Force UTF-8 encoding
    index_html = index_response.text
    index_soup = bs4.BeautifulSoup(index_html, "html.parser")

    slug_cat = {}
    for card in index_soup.select(".example-item"):
        href = card.select_one("a[href]")["href"]
        m = slug_re.match(href)
        if not m: continue
        slug = m.group(1)
        label = card.select_one(".category-label")
        slug_cat[slug] = canon(label.get_text(strip=True) if label else "")

    links = [urllib.parse.urljoin(BASE, f"/exempel/{s}") for s in slug_cat]
    print(f"Found {len(links)} links to process")

    meta = {}

    # ── skrapa varje gallerisida ────────────────────────────────────────────
    def scrape(url: str):
        try:
            slug = slug_re.search(urllib.parse.urlparse(url).path).group(1)
            
            # Get page with proper encoding
            response = sess.get(url, timeout=20)
            response.encoding = 'utf-8'  # Force UTF-8 encoding
            soup = bs4.BeautifulSoup(response.text, "html.parser")

            manuf = soup.select_one("#tillverkare")
            manuf = manuf.get_text(strip=True) if manuf else ""
            model = soup.select_one("#modell")
            model = model.get_text(strip=True) if model else ""

            # fallback – försök dela första ordet = tillverkare, resten = modell
            if not manuf and model:
                parts = model.split(maxsplit=1)
                if len(parts) == 2:
                    manuf, model = parts

            # Improved info extraction with proper label cleaning
            info = {}
            for div in soup.select(".more-info-text-div"):
                label_elem = div.select_one(".more-info-label")
                text_elem = div.select_one(".more-info-text")
                
                if label_elem and text_elem:
                    label = label_elem.get_text(strip=True)
                    text = text_elem.get_text(strip=True)
                    clean_label_key = clean_label(label)
                    info[clean_label_key] = text

            category = canon(slug_cat.get(slug, info.get("variant", "")))

            urls = set()
            urls.update(i["src"].split("?")[0] for i in soup.select("img.example-top-image"))
            for s in soup.select("script.w-json"):
                try:
                    data = json.loads(s.string)
                    urls.update(i["url"].split("?")[0] for i in data.get("items", [])
                                if i.get("type") == "image")
                except Exception:
                    pass

            folder = ROOTDIR / slugify(category) / slug
            folder.mkdir(parents=True, exist_ok=True)

            files = []
            for idx, img_url in enumerate(sorted(urls), 1):
                ext  = pathlib.Path(urllib.parse.urlparse(img_url).path).suffix.lower()
                name = f"{slug}_{idx:02d}{ext}"
                dest = folder / name
                if not dest.exists():
                    try:
                        with sess.get(img_url, stream=True, timeout=30) as r, open(dest, "wb") as f:
                            for chunk in r.iter_content(8192):
                                f.write(chunk)
                    except Exception as e:
                        print(f"Error downloading {img_url}: {e}")
                        continue
                files.append(str(dest.relative_to(ROOTDIR)))

            meta[slug] = {
                "manufacturer": manuf,
                "model": model,
                "description": info.get("beskrivning", ""),
                "variant": info.get("variant", ""),
                "delivery": info.get("leveransinfo", ""),
                "category": category,
                "images": files,
                "source": url
            }
            print(f"  ✔ {slug:25} {category:35} {len(files)} bilder")
        except Exception as e:
            print(f"Error processing {url}: {e}")

    # Process only first 5 links for testing
    test_links = links[:5]
    print(f"Testing with first {len(test_links)} links...")
    
    with concurrent.futures.ThreadPoolExecutor(THREADS) as ex:
        ex.map(scrape, test_links)

    ROOTDIR.mkdir(exist_ok=True)
    (ROOTDIR / "models_meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    print("✓ färdigt – allt sparat i henricssons_bilder/")

except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc() 
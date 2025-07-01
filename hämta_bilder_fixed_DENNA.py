#!/usr/bin/env python3
"""
Skrapar Henricssons "Bilder & exempel":

henricssons_bilder/
├─ batstolar-dynor/
├─ vavprover-ovriga/
├─ motorbatar/
├─ segelbatar/
├─ specialsommnad-skraddarsytt/
├─ sunbrella-plus-kollektion-vavprover/
└─ okategoriserad/
    └─ <slug>/<slug>_01.jpg …

Metadata sparas i henricssons_bilder/models_meta.json
"""

import re, json, pathlib, urllib.parse, concurrent.futures, requests, bs4
from unidecode import unidecode

BASE     = "https://www.henricssonsbatkapell.se"
START    = f"{BASE}/bilder-och-exempel"
ROOTDIR  = pathlib.Path("henricssons_bilder")
THREADS  = 8

sess = requests.Session()
sess.headers["User-Agent"] = "HenricssonsScraper/5.1"

slug_re = re.compile(r"^/exempel/([a-z0-9\-]+)$", re.I)

# ── kategorimappning ────────────────────────────────────────────────────────
def canon(label: str) -> str:
    # Normalisera: ASCII-lowercase utan diakritiska tecken för robust matchning
    l_raw = label or ""
    l = unidecode(l_raw).lower()
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
    if any(key in l for key in ("stol", "stolar", "dyna", "dynor")):
        return "Båtstolar & Dynor"
    return "Okategoriserad"

def slugify(txt: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", unidecode(txt.lower())).strip("-") or "okategoriserad"

print("⏳ Hämtar gallerier …")

# ── hämta index & slug → kategori ───────────────────────────────────────────
index_resp = sess.get(START, timeout=20); index_resp.encoding='utf-8'; index_html=index_resp.text
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

meta = {}

# ── skrapa varje gallerisida ────────────────────────────────────────────────
def scrape(url: str):
    slug = slug_re.search(urllib.parse.urlparse(url).path).group(1)
    page_resp = sess.get(url, timeout=20); page_resp.encoding='utf-8'
    soup = bs4.BeautifulSoup(page_resp.text, "html.parser")

    manuf = soup.select_one("#tillverkare")
    manuf = manuf.get_text(strip=True) if manuf else ""
    model = soup.select_one("#modell")
    model = model.get_text(strip=True) if model else ""

    # fallback – försök dela första ordet = tillverkare, resten = modell
    if not manuf and model:
        parts = model.split(maxsplit=1)
        if len(parts) == 2:
            manuf, model = parts

    # Byt ut info-extraktionen mot en robustare variant
    def normalize_label(label):
        # Ta bort kolon, whitespace, gör lowercase
        return re.sub(r'[^a-zA-Z0-9]', '', label).lower()

    info = {}
    for div in soup.select('.more-info-text-div'):
        label_elem = div.select_one('.more-info-label')
        text_elem = div.select_one('.more-info-text')
        if not (label_elem and text_elem):
            continue
        label = normalize_label(label_elem.get_text(strip=True))
        text = text_elem.get_text(strip=True)
        info[label] = text

    # Fält-mappning: matcha robust
    def get_info_field(info, *candidates):
        for cand in candidates:
            cand_norm = re.sub(r'[^a-zA-Z0-9]', '', cand).lower()
            if cand_norm in info:
                return info[cand_norm]
        return ""

    # Hämta kategori från själva sidan om möjligt
    page_cat_el = soup.select_one('.category-label')
    page_cat = canon(page_cat_el.get_text(strip=True)) if page_cat_el else ""

    # Bestäm slutlig kategori – ordning: sidans etikett > index-mappning > variant-fältet
    category = page_cat or canon(slug_cat.get(slug, get_info_field(info, "variant")))

    # Mappnamn = rubriken (tillverkare + modell) snarare än slug
    title_raw = f"{manuf} {model}".strip() or slug
    folder = ROOTDIR / slugify(category) / slugify(title_raw)

    urls = set()
    urls.update(i["src"].split("?")[0] for i in soup.select("img.example-top-image"))
    for s in soup.select("script.w-json"):
        try:
            data = json.loads(s.string)
            urls.update(i["url"].split("?")[0] for i in data.get("items", [])
                        if i.get("type") == "image")
        except Exception:
            pass

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
            except Exception:
                continue
        files.append(str(dest.relative_to(ROOTDIR)))

    meta[slug] = {
        "manufacturer": manuf,
        "model": model,
        "description": get_info_field(info, "beskrivning"),
        "variant": get_info_field(info, "variant"),
        "delivery": get_info_field(info, "leveransinfo"),
        "category": category,
        "images": files,
        "source": url
    }
    print(f"  ✔ {slug:25} {category:35} {len(files)} bilder")

with concurrent.futures.ThreadPoolExecutor(THREADS) as ex:
    ex.map(scrape, links)

ROOTDIR.mkdir(exist_ok=True)
(ROOTDIR / "models_meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
print("✓ färdigt – allt sparat i henricssons_bilder/") 
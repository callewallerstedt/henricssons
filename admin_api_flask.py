from __future__ import annotations

import base64
import html
import ipaddress
import json
import os
import re
from datetime import datetime
from functools import wraps
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

import requests
from flask import Flask, Response, abort, jsonify, redirect, render_template_string, request, send_from_directory
from sqlalchemy import Boolean, Column, DateTime, Integer, JSON as SQLJSON, String, Text, create_engine
from sqlalchemy.orm import Session, declarative_base, sessionmaker

app = Flask(__name__)

BASE_DIR = Path(__file__).resolve().parent
BOAT_DATA_FILE = BASE_DIR / "boat_data.json"
FORM_SUBMISSIONS_FILE = BASE_DIR / "form_submissions.json"
FORM_PROMPTS_FILE = BASE_DIR / "form_prompts.json"
PAGE_TEXTS_FILE = BASE_DIR / "page_texts.json"
AI_SETTINGS_FILE = BASE_DIR / "ai_settings.json"
IMAGES_ROOT = (BASE_DIR / "henricssons_bilder").resolve()
MODELS_META_FILE = IMAGES_ROOT / "models_meta.json"
EXAMPLES_META_FILE = BASE_DIR / "examples_meta.json"
PUBLIC_BASE_URL = "https://www.henricssonsbatkapell.se"
GENERIC_EXAMPLE_DESCRIPTION = (
    "Vi tillverkar kapell till många typer av båtar. Med vårat mallregister med egen tillverkning "
    "och tillsammans med vår import av originalkapell från Norge Finland och Danmark så täcker vi "
    "ett brett register av modeller"
)
CORE_PUBLIC_PATHS = [
    "/",
    "/om-oss",
    "/bilder-och-exempel",
    "/search",
    "/tillbehor",
    "/kontakt",
    "/kapellforfragan",
]
LEGACY_EXAMPLE_REDIRECTS = {
    "16-ht": "/bilder-och-exempel",
    "215-pilot-house": "/bilder-och-exempel",
    "26-2657": "/exempel/26-2656",
    "26-aldre-med-traram-doghouse-specialkapell": "/exempel/26-102-71-aldre-korta-std-traram-doghouse",
    "26-dc-utan-targa": "/exempel/26-dc",
    "27-sun-cruiser": "/bilder-och-exempel",
    "28-2": "/exempel/28",
    "30-scampi": "/bilder-och-exempel",
    "31-sprayhood-for-22mm-bagar": "/exempel/if-sprayhood-22mm-bagar",
    "32-specialsprayhood": "/exempel/32",
    "33": "/bilder-och-exempel",
    "34-3": "/exempel/34",
    "505-ht-d-a": "/exempel/505-ht",
    "510gts-konsollhuv": "/exempel/510-pulpethuv",
    "565-ht": "/exempel/560-ht",
    "5820-58br-original-dynsats": "/exempel/5820",
    "630wa-fam": "/exempel/6230wa",
    "630wa-fam-2": "/exempel/6230wa",
    "635-wa-utan-racke-vindruta": "/exempel/635-wa",
    "640-dc-original-hamnkapell-2": "/exempel/640-dc-original-hamnkapell",
    "6600-wa-med-targabage": "/bilder-och-exempel",
    "68-br-originalkapell": "/exempel/68-dc-originalkapell",
    "680-snipa-originalkapell": "/bilder-och-exempel",
    "7700ht-originalkapell": "/bilder-och-exempel",
    "95-sprayhood-till-originalbagar": "/exempel/cumulus-sprayhood-pa-originalbagar",
    "le": "/exempel/l",
    "magnum-dynsats-original-1999-2001": "/exempel/magnum-dynsats-original",
    "magnum-dynsats-original-2010-2014": "/exempel/magnum-dynsats-original",
    "magnum-original-hamnkapell-02-10": "/exempel/magnum-hamnkapell",
    "s51": "/exempel/s52",
    "xxl-hamnkapell-2015-2019": "/exempel/xxl",
    "xxl-originalkapell-2015-2019": "/exempel/xxl",
}

DEFAULT_DATABASE_URL = f"sqlite:///{(BASE_DIR / 'henricssons.db').as_posix()}"
DATABASE_URL = os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL)
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-5-mini")
CHAT_MODEL = os.getenv("CHAT_MODEL", "gpt-5-mini").strip() or "gpt-5-mini"
OPENAI_REASONING_EFFORT = os.getenv("OPENAI_REASONING_EFFORT", "minimal").strip().lower() or "minimal"
ADMIN_API_KEY = os.getenv("ADMIN_API_KEY", "").strip()
MAILGUN_DOMAIN = os.getenv("MAILGUN_DOMAIN", "").strip()
MAILGUN_API_KEY = os.getenv("MAILGUN_API_KEY", "").strip()
MAILGUN_FROM = os.getenv("MAILGUN_FROM", "").strip()
MAILGUN_TO_RAW = os.getenv("MAILGUN_TO", "").strip()
MAILGUN_API_BASE = os.getenv("MAILGUN_API_BASE", "https://api.mailgun.net").strip().rstrip("/")

DEFAULT_ALLOWED_ORIGINS = ",".join(
    [
        "https://henricssonsbatkapell.se",
        "https://www.henricssonsbatkapell.se",
        "https://henricssons.se",
        "https://www.henricssons.se",
        "https://henricssons-api.onrender.com",
        "http://localhost:25565",
        "http://127.0.0.1:25565",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]
)
ALLOWED_ORIGINS = {
    origin.strip() for origin in os.getenv("ALLOWED_ORIGINS", DEFAULT_ALLOWED_ORIGINS).split(",") if origin.strip()
}
PRIMARY_PUBLIC_HOST = "www.henricssonsbatkapell.se"
PUBLIC_HOST_ALIASES = {"henricssonsbatkapell.se", "www.henricssonsbatkapell.se"}

MAX_UPLOAD_BYTES = 8 * 1024 * 1024
ALLOWED_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}
STATUS_FLOW = ["nya-inskick", "vantar-pa-svar", "i-produktion", "redo-for-leverans"]
MOJIBAKE_MARKERS = ("Ã", "Â", "â")

Base = declarative_base()


class FormSubmission(Base):
    __tablename__ = "form_submissions"

    id = Column(String, primary_key=True)
    form_type = Column(String, nullable=False)
    category = Column(String)
    title = Column(String)
    fields = Column(SQLJSON)
    form_summary = Column(Text)
    proposed_response = Column(Text)
    timestamp = Column(DateTime, default=datetime.utcnow)
    status = Column(String, default="nya-inskick")
    read = Column(Boolean, default=False)

    def to_dict(self) -> Dict[str, Any]:
        submitted_via = "web_form"
        notes = ""
        if isinstance(self.fields, dict):
            submitted_via = str(self.fields.get("__submitted_via", "web_form"))
            notes = str(self.fields.get("__internal_notes", "") or "")
        return {
            "id": self.id,
            "form_type": self.form_type,
            "category": self.category,
            "title": self.title,
            "fields": self.fields,
            "form_summary": self.form_summary,
            "proposed_response": self.proposed_response,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "status": self.status,
            "read": self.read,
            "submitted_via": submitted_via,
            "notes": notes,
        }


class FormPrompt(Base):
    __tablename__ = "form_prompts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    form_type = Column(String, unique=True, nullable=False)
    prompt_text = Column(Text, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SiteContent(Base):
    __tablename__ = "site_content"

    key = Column(String, primary_key=True)
    data = Column(SQLJSON, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


engine = None
SessionLocal = None


def init_db() -> None:
    global engine, SessionLocal
    try:
        kwargs: Dict[str, Any] = {"future": True}
        if DATABASE_URL.startswith("sqlite"):
            kwargs["connect_args"] = {"check_same_thread": False}
        else:
            kwargs["pool_pre_ping"] = True
        engine = create_engine(DATABASE_URL, **kwargs)
        Base.metadata.create_all(engine)
        SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
        print("Database connected.")
    except Exception as exc:
        print(f"Warning: database init failed, file fallback will be used: {exc}")
        engine = None
        SessionLocal = None


def get_db() -> Optional[Session]:
    if SessionLocal is None:
        return None
    try:
        return SessionLocal()
    except Exception:
        return None


def is_local_request() -> bool:
    remote = (request.remote_addr or "").strip().split("%")[0]
    host = (request.host or "").split(":")[0].strip().lower()

    if remote in {"127.0.0.1", "::1"}:
        return True

    try:
        remote_ip = ipaddress.ip_address(remote)
    except ValueError:
        return False

    if not (remote_ip.is_private or remote_ip.is_loopback):
        return False

    if host in {"localhost", "127.0.0.1", "::1"}:
        return True
    try:
        host_ip = ipaddress.ip_address(host)
        return host_ip.is_private or host_ip.is_loopback
    except ValueError:
        return False


def check_admin_access() -> bool:
    if ADMIN_API_KEY:
        header_key = request.headers.get("X-Admin-Key", "").strip()
        auth_header = request.headers.get("Authorization", "").strip()
        bearer_key = ""
        if auth_header.lower().startswith("bearer "):
            bearer_key = auth_header[7:].strip()
        return header_key == ADMIN_API_KEY or bearer_key == ADMIN_API_KEY
    return is_local_request()


def admin_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not check_admin_access():
            return jsonify(error="Admin authorization required"), 403
        return fn(*args, **kwargs)

    return wrapper


@app.before_request
def enforce_public_host() -> Optional[Any]:
    if request.method not in {"GET", "HEAD"}:
        return None
    host_header = request.headers.get("X-Forwarded-Host", request.host or "")
    host = host_header.split(",")[0].strip().split(":")[0].lower()
    if host not in PUBLIC_HOST_ALIASES:
        return None
    proto = request.headers.get("X-Forwarded-Proto", request.scheme or "http").split(",")[0].strip().lower()
    if host == PRIMARY_PUBLIC_HOST and proto == "https":
        return None
    target = f"https://{PRIMARY_PUBLIC_HOST}{request.full_path}".rstrip("?")
    return redirect(target, code=301)


def read_json_file(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        return default


def write_json_file(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with tmp_path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2, ensure_ascii=False)
    os.replace(tmp_path, path)


def has_mojibake_markers(text: str) -> bool:
    return any(marker in text for marker in MOJIBAKE_MARKERS)


def repair_mojibake_text(text: str) -> str:
    if not text:
        return text
    core = text[1:] if text.startswith("\ufeff") else text
    for source_encoding in ("cp1252", "latin-1"):
        try:
            candidate = core.encode(source_encoding).decode("utf-8")
        except Exception:
            continue
        if candidate != core:
            return candidate
    return core


def absolute_public_url(path: str) -> str:
    if not path or path == "/":
        return PUBLIC_BASE_URL
    clean = path if path.startswith("/") else f"/{path}"
    return f"{PUBLIC_BASE_URL}{clean}"


def normalize_example_record(raw: Any, fallback_slug: str = "") -> Dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    images = raw.get("images") or []
    if not isinstance(images, list):
        images = []
    return {
        "manufacturer": str(raw.get("manufacturer", "") or "").strip(),
        "model": str(raw.get("model", "") or "").strip(),
        "description": str(raw.get("description", "") or "").strip(),
        "variant": str(raw.get("variant", "") or "").strip(),
        "delivery": str(raw.get("delivery", "") or "").strip(),
        "category": str(raw.get("category", "") or "").strip(),
        "images": [str(image or "").strip() for image in images if str(image or "").strip()],
        "source": str(raw.get("source", "") or "").strip(),
        "fallback_slug": fallback_slug.strip(),
    }


def extract_example_slug(source: str, fallback_slug: str = "") -> str:
    source = str(source or "").strip()
    if source:
        parsed = urlparse(source)
        path = parsed.path.strip("/")
        if path.startswith("exempel/"):
            return path.split("/", 1)[1].strip()
    return fallback_slug.strip()


def image_path_to_site_url(image_path: str) -> str:
    clean = str(image_path or "").strip().replace("\\", "/")
    if not clean:
        return "/logo.png"
    if clean.startswith("http://") or clean.startswith("https://") or clean.startswith("data:"):
        return clean
    if clean.startswith("assets/"):
        return f"/{clean}"
    if clean.startswith("henricssons_bilder/"):
        return f"/{clean}"
    return f"/henricssons_bilder/{clean.lstrip('/')}"


def merge_example_records(base_record: Dict[str, Any], override_record: Dict[str, Any]) -> Dict[str, Any]:
    fields = ("manufacturer", "model", "description", "variant", "delivery", "category", "source", "fallback_slug", "canonical_slug")
    merged = dict(base_record or {})
    for field in fields:
        override_value = str(override_record.get(field, "") or "").strip()
        if override_value:
            merged[field] = override_value
    base_images = list(base_record.get("images") or [])
    override_images = list(override_record.get("images") or [])
    if override_images and (not base_images or len(override_images) >= len(base_images)):
        merged["images"] = override_images
    else:
        merged["images"] = base_images
    return merged


def build_example_registry() -> Dict[str, Dict[str, Any]]:
    registry: Dict[str, Dict[str, Any]] = {}

    models_meta = read_json_file(MODELS_META_FILE, {})
    if isinstance(models_meta, dict):
        for key, raw in models_meta.items():
            normalized = normalize_example_record(raw, fallback_slug=str(key))
            canonical_slug = extract_example_slug(normalized.get("source", ""), str(key))
            normalized["canonical_slug"] = canonical_slug
            if canonical_slug:
                registry[canonical_slug] = merge_example_records(registry.get(canonical_slug, {}), normalized)
            if key and str(key) != canonical_slug:
                registry[str(key)] = merge_example_records(registry.get(str(key), {}), normalized)

    examples_meta = read_json_file(EXAMPLES_META_FILE, {})
    if isinstance(examples_meta, dict):
        for key, raw in examples_meta.items():
            fallback_slug = str(key).split("::", 1)[-1].strip()
            normalized = normalize_example_record(raw, fallback_slug=fallback_slug)
            canonical_slug = extract_example_slug(normalized.get("source", ""), fallback_slug)
            normalized["canonical_slug"] = canonical_slug
            if canonical_slug:
                registry[canonical_slug] = merge_example_records(registry.get(canonical_slug, {}), normalized)
            if fallback_slug and fallback_slug != canonical_slug:
                registry[fallback_slug] = merge_example_records(registry.get(fallback_slug, {}), normalized)

    return registry


def list_canonical_examples() -> List[Dict[str, Any]]:
    canonical_examples: Dict[str, Dict[str, Any]] = {}
    for slug, record in build_example_registry().items():
        canonical_slug = str(record.get("canonical_slug", "") or "").strip()
        if not canonical_slug:
            continue
        record_with_slug = dict(record)
        record_with_slug["canonical_slug"] = canonical_slug
        canonical_examples[canonical_slug] = merge_example_records(canonical_examples.get(canonical_slug, {}), record_with_slug)
    items = list(canonical_examples.values())
    items.sort(key=lambda item: (str(item.get("manufacturer", "")).lower(), str(item.get("model", "")).lower(), str(item.get("canonical_slug", "")).lower()))
    return items


def render_public_page(title: str, description: str, canonical_path: str, content_html: str, og_image: str = "/logo.png") -> str:
    canonical_url = absolute_public_url(canonical_path)
    og_image_url = og_image if og_image.startswith("http://") or og_image.startswith("https://") else absolute_public_url(og_image)
    return render_template_string(
        """<!DOCTYPE html>
<html lang="sv">
<head>
    <meta charset="utf-8"/>
    <title>{{ title }}</title>
    <meta name="description" content="{{ description }}"/>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&family=Lora:wght@400;500;600;700&family=Libre+Baskerville:wght@400;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/styles.css?v=20250630">
    <link rel="icon" href="/logo.png">
    <link rel="canonical" href="{{ canonical_url }}"/>
    <meta property="og:title" content="{{ title }}"/>
    <meta property="og:description" content="{{ description }}"/>
    <meta property="og:image" content="{{ og_image_url }}"/>
    <meta property="og:type" content="website"/>
    <meta property="og:url" content="{{ canonical_url }}"/>
    <meta name="twitter:card" content="summary_large_image"/>
    <meta name="twitter:title" content="{{ title }}"/>
    <meta name="twitter:description" content="{{ description }}"/>
    <meta name="twitter:image" content="{{ og_image_url }}"/>
    <style>
        .seo-shell { min-height: 100vh; background: #f7f4ee; }
        .seo-page { max-width: 1180px; margin: 0 auto; padding: 3rem 1.25rem 4rem; }
        .seo-hero { display: grid; gap: 1.25rem; margin-bottom: 2rem; }
        .seo-kicker { color: #8b6f18; font-size: 0.8rem; letter-spacing: 0.12em; text-transform: uppercase; font-weight: 700; }
        .seo-breadcrumbs { display: flex; flex-wrap: wrap; gap: 0.5rem; color: #5d5d5d; font-size: 0.92rem; margin-bottom: 1rem; }
        .seo-breadcrumbs a { color: inherit; text-decoration: none; }
        .seo-breadcrumbs a:hover { text-decoration: underline; }
        .seo-grid { display: grid; gap: 2rem; grid-template-columns: minmax(0, 1.35fr) minmax(280px, 0.85fr); align-items: start; }
        .seo-card { background: #fff; border: 1px solid rgba(10, 35, 66, 0.08); box-shadow: 0 16px 40px rgba(10, 35, 66, 0.08); padding: 1.5rem; }
        .seo-gallery { display: grid; gap: 0.9rem; }
        .seo-gallery-main img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; display: block; background: #ece7da; }
        .seo-thumbs { display: grid; grid-template-columns: repeat(auto-fit, minmax(88px, 1fr)); gap: 0.75rem; }
        .seo-thumbs img { width: 100%; aspect-ratio: 1; object-fit: cover; display: block; background: #ece7da; }
        .seo-meta { display: grid; gap: 0.9rem; }
        .seo-meta-block { border-top: 1px solid rgba(10, 35, 66, 0.08); padding-top: 0.9rem; }
        .seo-meta-label { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.08em; color: #8b6f18; font-weight: 700; margin-bottom: 0.35rem; }
        .seo-cta-row { display: flex; flex-wrap: wrap; gap: 0.8rem; margin-top: 1.2rem; }
        .seo-btn { display: inline-flex; align-items: center; justify-content: center; min-height: 46px; padding: 0 1.2rem; text-decoration: none; font-weight: 700; letter-spacing: 0.03em; border: 1px solid #0a2342; color: #0a2342; background: #fff; }
        .seo-btn.seo-btn-primary { background: #c8a93f; border-color: #c8a93f; color: #0a2342; }
        .seo-related { margin-top: 2.5rem; }
        .seo-related-grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
        .seo-related-card { background: #fff; border: 1px solid rgba(10, 35, 66, 0.08); text-decoration: none; color: #0a2342; overflow: hidden; }
        .seo-related-card img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; display: block; background: #ece7da; }
        .seo-related-copy { padding: 1rem; }
        .seo-search-form { display: flex; gap: 0.75rem; flex-wrap: wrap; margin: 1.2rem 0 1.8rem; }
        .seo-search-form input { flex: 1 1 260px; min-height: 48px; padding: 0 1rem; border: 1px solid rgba(10, 35, 66, 0.16); font: inherit; }
        .seo-search-list { display: grid; gap: 0.9rem; }
        .seo-search-item { background: #fff; border: 1px solid rgba(10, 35, 66, 0.08); padding: 1rem 1.1rem; display: grid; gap: 0.35rem; }
        @media (max-width: 900px) {
            .seo-grid { grid-template-columns: 1fr; }
            .seo-page { padding-top: 2rem; }
        }
    </style>
</head>
<body class="seo-shell">
    <header class="header">
        <nav class="navbar">
            <a href="/" class="nav-logo">
                <img src="/logo.png" alt="Henricssons Båtkapell Logo"/>
            </a>
            <button class="menu-btn" aria-label="Toggle menu">
                <span class="menu-line"></span>
                <span class="menu-line"></span>
                <span class="menu-line"></span>
            </button>
            <div class="nav-menu">
                <a href="/om-oss" class="nav-link">Om oss</a>
                <a href="/kapellforfragan" class="nav-link">Kapellförfrågan</a>
                <a href="/bilder-och-exempel" class="nav-link">Bilder & exempel</a>
                <a href="/tillbehor" class="nav-link">Fenderstrumpor</a>
                <a href="/kontakt" class="nav-link">Kontakt</a>
            </div>
        </nav>
    </header>
    <div class="cta-line--nav"></div>
    <div class="nav-rugged-border"></div>

    {{ content_html | safe }}

    <footer class="footer">
        <div class="footer-content">
            <div class="footer-section">
                <img src="/logo.png" alt="Henricssons Båtkapell Logo" class="footer-logo"/>
                <div class="divider" style="margin-left:0; margin-right:auto;"></div>
                <p>Vi gör kapell till många olika typer av båtar. Med vårat mallregister med egen tillverkning och tillsammans med vår import av originalkapell från Norge Finland och Danmark så täcker vi ett brett register av modeller</p>
            </div>
            <div class="footer-section">
                <h2 style="text-align:left;">Partners</h2>
                <div class="divider" style="margin-left:0; margin-right:auto;"></div>
                <div class="partners-grid">
                    <img src="/assets/jens sagen.png" alt="Jens Sagen" class="partner-logo"/>
                    <img src="/assets/5e79d73a63cc8b5939552a05_helly-hansen.svg" alt="Helly Hansen" class="partner-logo"/>
                    <img src="/assets/Varuste.png" alt="VA Varuste" class="partner-logo"/>
                    <img src="/assets/schultz.png" alt="Schultz Kalecher" class="partner-logo"/>
                    <img src="/assets/mpvenekuomo.png" alt="MP Venekuomu" class="partner-logo" style="grid-column: span 2;"/>
                </div>
            </div>
            <div class="footer-section">
                <h2 style="text-align:left;">Kontakt</h2>
                <div class="divider" style="margin-left:0; margin-right:auto;"></div>
                <p>
                    +46 (0)31 471820<br/>
                    Energigatan 17E<br/>
                    434 37 Kungsbacka<br/>
                    <a href="mailto:info@henricssonsbatkapell.se">info@henricssonsbatkapell.se</a>
                </p>
                <div class="credit-rating">
                    <img src="/KV.svg" alt="Kreditvärdighet" class="credit-logo"/>
                    <div class="credit-text">
                        <div class="credit-title">HÖGSTA KREDITVÄRDIGHET</div>
                        <div class="credit-company">Henricssons Båtkapell AB</div>
                        <div class="credit-details">556799-2192 | 2025-11-25</div>
                    </div>
                </div>
            </div>
        </div>
    </footer>
    <script src="/script.js"></script>
    <script src="/chat_widget.js?v=20260416d"></script>
</body>
</html>""",
        title=title,
        description=description,
        canonical_url=canonical_url,
        og_image_url=og_image_url,
        content_html=content_html,
    )


def auto_repair_static_text_files() -> List[Path]:
    repaired: List[Path] = []
    # Only repair editable text files in project root that are served directly.
    for pattern in ("*.html", "*.js", "*.css", "*.txt"):
        for path in BASE_DIR.glob(pattern):
            if not path.is_file():
                continue
            try:
                content = path.read_text(encoding="utf-8")
            except Exception:
                continue
            if not has_mojibake_markers(content):
                continue
            fixed = repair_mojibake_text(content)
            if fixed != content:
                path.write_text(fixed, encoding="utf-8", newline="")
                repaired.append(path)
    return repaired


def set_site_content(key: str, data: Any) -> None:
    db = get_db()
    if not db:
        return
    try:
        row = db.query(SiteContent).filter_by(key=key).first()
        if row:
            row.data = data
            row.updated_at = datetime.utcnow()
        else:
            db.add(SiteContent(key=key, data=data))
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


def get_site_content(key: str) -> Optional[Any]:
    db = get_db()
    if not db:
        return None
    try:
        row = db.query(SiteContent).filter_by(key=key).first()
        return row.data if row else None
    except Exception:
        return None
    finally:
        db.close()


DEFAULT_FORM_PROMPTS: Dict[str, str] = {
    "Kapellforfragan": (
        "Du svarar på inkomna kapellförfrågningar för Henricssons Båtkapell. "
        "Svara kort, tryggt och professionellt på svenska. "
        "Bekräfta båt och behov, ge ett tydligt nästa steg och be bara om komplettering "
        "om någon avgörande uppgift saknas för offert eller måttagning."
    ),
    "Fenderforfragan": (
        "Du svarar på inkomna förfrågningar om fenderstrumpor. "
        "Svara kort, tydligt och professionellt på svenska. "
        "Bekräfta antal och storlek, ge ett tydligt nästa steg och be bara om komplettering "
        "om någon avgörande uppgift saknas för offert eller order."
    ),
    "Kontakt": (
        "Du svarar på allmänna kontaktförfrågningar. "
        "Svara kort, hjälpsamt och professionellt på svenska. "
        "Identifiera syftet snabbt, svara direkt om möjligt och be bara om den komplettering "
        "som verkligen behövs för ett tydligt nästa steg."
    ),
}

EMAIL_REQUIRED_OPENING = "Tack för att du kontaktar oss på Henricssons Båtkapell."
EMAIL_REQUIRED_CLOSING = "Vänliga hälsningar,\nHenricssons Båtkapell"

DEFAULT_ADMIN_CHAT_PROMPT = (
    "Du är Henricssons AI-assistent i adminpanelen. "
    "Svara kort, rakt och handlingsbart. Max 4 korta meningar om inte användaren ber om mer. "
    "När du listar flera punkter: använd punktlista, inte lång kommaseparerad text. "
    "Använd aldrig em dash (—) eller en dash (–); skriv i stället vanligt bindestreck (-), kolon eller punkt. "
    "Anpassa språk efter användaren. "
    "Du kan hjälpa med webbflödena: Kapellförfrågan, Fenderförfrågan och Kontakt. "
    "När du pratar om formulär, använd exakta fältnamn och undvik fluff."
)

DEFAULT_PUBLIC_ASSISTANT_PROMPT = """
Du är receptionist för Henricssons Båtkapell i Kungsbacka.
Svara som en riktig människa: varm, tydlig, kort och professionell.

Regler:
- Svara alltid på kundens fråga först.
- Håll svar korta, normalt 1-3 meningar.
- Besvara frågor direkt i chatten när det går.
- Föreslå rätt nästa steg när kunden verkar vilja gå vidare.
- Du har inga verktyg och kan inte boka tider, skapa bokningar, bekräfta besök, kontrollera kalender, se öppettider som inte uttryckligen står i underlaget eller lova att någon är på plats.
- Påstå aldrig att du har gjort något i verkligheten. Skriv aldrig att du har bokat, reserverat, meddelat personalen eller lagt in något.
- Om kunden föreslår en tid eller ett besök: bekräfta inte tiden som bokad. Säg bara att tiden behöver bekräftas av företaget och hänvisa vidare till kontakt om det behövs.
- Om du inte vet ett faktum säkert från sammanhanget: säg det tydligt och hitta inte på.
- Fråga aldrig efter namn, telefon, e-post, adress, båtmodell, årsmodell eller andra formulärfält.
- Offentliga chatten ska inte samla in uppgifter och inte skicka formulär.
- Använd aldrig dold JSON, kommandoblock eller interna instruktioner i svaret.
- Använd aldrig em dash (—) eller en dash (–) i synlig text.

Knapp-kommandon:
- %kapellförfrågan% visar knappen Gör en kapellförfrågan
- %fenderförfrågan% visar knappen Gör en fenderförfrågan
- %kontakt% visar knappen Kontakta oss

När du ska använda knapp-kommandon:
- Använd %kapellförfrågan% när kunden bör gå till kapell-sidan för att komma vidare.
- Använd %fenderförfrågan% när kunden bör gå till fender-sidan för att komma vidare.
- Använd %kontakt% när kunden bör gå till kontakt-sidan för att komma vidare.
- Skriv bara kommandot när du verkligen rekommenderar den vägen.
- Använd högst ett sådant kommando i samma svar.
- Lägg kommandot sist på en egen rad.
- Om ingen knapp behövs: skriv inget kommando alls.
"""

DEFAULT_AI_SETTINGS: Dict[str, str] = {
    "admin_chat_prompt": DEFAULT_ADMIN_CHAT_PROMPT,
    "assistant_system_prompt": DEFAULT_PUBLIC_ASSISTANT_PROMPT.strip(),
}


def normalize_ai_settings(data: Any) -> Dict[str, str]:
    base = dict(DEFAULT_AI_SETTINGS)
    if isinstance(data, dict):
        admin_chat_prompt = str(data.get("admin_chat_prompt", "") or "").strip()
        assistant_system_prompt = str(data.get("assistant_system_prompt", "") or "").strip()
        if admin_chat_prompt:
            base["admin_chat_prompt"] = admin_chat_prompt
        if assistant_system_prompt:
            base["assistant_system_prompt"] = assistant_system_prompt
    return base


def load_ai_settings() -> Dict[str, str]:
    data = get_site_content("ai_settings")
    if not isinstance(data, dict):
        file_data = read_json_file(AI_SETTINGS_FILE, {})
        data = file_data if isinstance(file_data, dict) else {}
    return normalize_ai_settings(data)


def save_ai_settings(data: Dict[str, Any]) -> Dict[str, str]:
    normalized = normalize_ai_settings(data)
    write_json_file(AI_SETTINGS_FILE, normalized)
    set_site_content("ai_settings", normalized)
    return normalized


def normalize_prompt_key(value: str) -> str:
    text = (value or "").strip().lower()
    if "fender" in text:
        return "Fenderforfragan"
    if "kapell" in text:
        return "Kapellforfragan"
    return "Kontakt"


def load_form_prompts() -> Dict[str, str]:
    db = get_db()
    prompts: Dict[str, str] = {}
    if db:
        try:
            for row in db.query(FormPrompt).all():
                prompts[normalize_prompt_key(row.form_type)] = row.prompt_text
        except Exception:
            prompts = {}
        finally:
            db.close()
    if not prompts:
        raw = read_json_file(FORM_PROMPTS_FILE, {})
        if isinstance(raw, dict):
            for key, value in raw.items():
                prompts[normalize_prompt_key(key)] = str(value)
    merged = dict(DEFAULT_FORM_PROMPTS)
    merged.update({k: v for k, v in prompts.items() if v})
    return merged


def save_form_prompts(data: Dict[str, str]) -> None:
    normalized: Dict[str, str] = {}
    for key, value in data.items():
        normalized[normalize_prompt_key(key)] = str(value or "")
    db = get_db()
    if db:
        try:
            for form_type, prompt_text in normalized.items():
                row = db.query(FormPrompt).filter_by(form_type=form_type).first()
                if row:
                    row.prompt_text = prompt_text
                    row.updated_at = datetime.utcnow()
                else:
                    db.add(FormPrompt(form_type=form_type, prompt_text=prompt_text))
            db.commit()
        except Exception:
            db.rollback()
        finally:
            db.close()
    write_json_file(FORM_PROMPTS_FILE, normalized)

def safe_json_loads(text: str) -> Optional[Dict[str, Any]]:
    if not text:
        return None
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        pass
    match = re.search(r"\{[\s\S]*\}", text)
    if not match:
        return None
    try:
        parsed = json.loads(match.group(0))
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        return None


def split_visible_text_and_command(text: str) -> Tuple[str, Optional[Dict[str, Any]]]:
    raw = str(text or "")
    if not raw:
        return "", None
    pattern = re.compile(
        re.escape(ASSISTANT_COMMAND_START) + r"\s*([\s\S]*?)\s*" + re.escape(ASSISTANT_COMMAND_END),
        flags=re.IGNORECASE,
    )
    matches = list(pattern.finditer(raw))
    if not matches:
        return raw.strip(), None
    visible = pattern.sub("", raw).strip()
    command_raw = matches[-1].group(1).strip()
    parsed = safe_json_loads(command_raw)
    return visible, parsed if isinstance(parsed, dict) else None


def recover_visible_reply_from_model(
    *,
    assistant_system_prompt: str,
    raw_output: str,
    customer_message: str,
    language: str,
    model: str,
) -> Tuple[str, Optional[Dict[str, Any]]]:
    repair_prompt = json.dumps(
        {
            "customer_message": customer_message,
            "previous_assistant_output": raw_output,
            "language": language,
            "task": "Return the same answer but with non-empty visible chat text first, then optional command block.",
            "command_markers": {"start": ASSISTANT_COMMAND_START, "end": ASSISTANT_COMMAND_END},
        },
        ensure_ascii=False,
    )
    repair_suffix = (
        "\n\nRepair requirements:\n"
        "- Visible customer-facing chat text is mandatory and cannot be empty.\n"
        f"- Optional command block markers are {ASSISTANT_COMMAND_START} and {ASSISTANT_COMMAND_END}.\n"
        "- Keep tone natural and concise.\n"
    )
    repaired = get_openai_response(
        repair_prompt,
        f"{assistant_system_prompt}\n{repair_suffix}",
        temperature=0.6,
        max_tokens=700,
        model=model,
    )
    return split_visible_text_and_command(repaired)


def get_openai_response(
    prompt: str,
    system_prompt: Optional[str] = None,
    temperature: float = 0.6,
    max_tokens: int = 900,
    response_format: Optional[Dict[str, Any]] = None,
    model: Optional[str] = None,
) -> str:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("OpenAI API key not configured")
    messages: List[Dict[str, str]] = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})
    target_model = (model or OPENAI_MODEL).strip()
    payload: Dict[str, Any] = {
        "model": target_model,
        "messages": messages,
        "temperature": temperature,
    }
    is_gpt5 = str(target_model).lower().startswith("gpt-5")
    if is_gpt5:
        payload["max_completion_tokens"] = max(int(max_tokens), 120)
        payload["reasoning_effort"] = OPENAI_REASONING_EFFORT
    else:
        payload["max_tokens"] = max_tokens
    if response_format:
        payload["response_format"] = response_format
    def post_chat(payload_data: Dict[str, Any]) -> requests.Response:
        return requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json=payload_data,
            timeout=45,
        )

    resp = post_chat(payload)
    if resp.status_code != 200 and is_gpt5:
        body = str(resp.text or "").lower()
        if "temperature" in body and "unsupported" in body:
            fallback_payload = dict(payload)
            fallback_payload.pop("temperature", None)
            resp = post_chat(fallback_payload)
    if resp.status_code != 200:
        raise RuntimeError(f"OpenAI API error: {resp.status_code} {resp.text}")
    data = resp.json()
    return data["choices"][0]["message"]["content"]


def normalize_form_type(value: str) -> str:
    lowered = (value or "").lower()
    if "fender" in lowered:
        return "Fenderforfragan"
    if "kapell" in lowered:
        return "Kapellforfragan"
    return "Kontakt"


def display_form_type(value: str) -> str:
    key = normalize_form_type(value)
    if key == "Kapellforfragan":
        return "Kapellförfrågan"
    if key == "Fenderforfragan":
        return "Fenderförfrågan"
    return "Kontakt"


def sanitize_fields(fields: Dict[str, Any], submitted_via: str) -> Dict[str, str]:
    clean: Dict[str, str] = {}
    for key, value in fields.items():
        k = str(key).strip()
        if not k:
            continue
        text = str(value or "").strip()
        if len(text) > 3000:
            text = text[:3000]
        clean[k] = text
    clean["__submitted_via"] = submitted_via
    return clean


def build_form_summary(form_type: str, fields: Dict[str, str]) -> str:
    lines = [f"Form type: {form_type}", ""]
    for key, value in fields.items():
        if key.startswith("__"):
            continue
        if value:
            lines.append(f"{key}: {value}")
    return "\n".join(lines)


def finalize_email_reply(text: str) -> str:
    raw = str(text or "").strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```[a-zA-Z0-9_-]*\s*", "", raw).rstrip("`").strip()
    if not raw:
        raw = "Vi har tagit emot din förfrågan och återkommer med nästa steg inom kort."

    # Remove optional greeting and duplicate opening before we enforce required framing.
    raw = re.sub(r"^\s*hej[^\n]*\n+", "", raw, flags=re.IGNORECASE).strip()
    raw = re.sub(
        r"^\s*tack för att du kontaktar oss på henricssons båtkapell\.?\s*",
        "",
        raw,
        flags=re.IGNORECASE,
    ).strip()

    # Remove old signatures if present, then enforce one consistent closing.
    raw = re.sub(
        r"\n*\s*vänliga hälsningar[\s\S]*$",
        "",
        raw,
        flags=re.IGNORECASE,
    ).strip()

    if not raw:
        raw = "Vi har tagit emot din förfrågan och återkommer med nästa steg inom kort."

    return f"{EMAIL_REQUIRED_OPENING}\n\n{raw}\n\n{EMAIL_REQUIRED_CLOSING}"


def generate_submission_metadata(
    form_type: str,
    fields: Dict[str, str],
    form_summary: str,
) -> Tuple[str, str, str]:
    category = "Allman fraga"
    title = f"{form_type}: {fields.get('1. Namn', fields.get('Namn', 'Kund'))}"
    if len(title) > 70:
        title = title[:67] + "..."

    prompts = load_form_prompts()
    system_prompt = prompts.get(normalize_form_type(form_type), prompts["Kontakt"])
    email_rules = (
        "Obligatoriska regler för mejlsvar:\n"
        f"1) Börja ALLTID exakt med: {EMAIL_REQUIRED_OPENING}\n"
        "2) Svara kort, tydligt och professionellt på svenska.\n"
        "3) Driv affären framåt: föreslå tydligt nästa steg.\n"
        "4) Om relevant information saknas: fråga efter den i en kort punktlista (max 3 punkter).\n"
        "5) Undvik fluff och långa stycken.\n"
        f"6) Avsluta ALLTID exakt med:\n{EMAIL_REQUIRED_CLOSING}\n"
        "7) Returnera endast själva mejltexten."
    )
    response_system_prompt = f"{system_prompt}\n\n{email_rules}"
    proposed_response = finalize_email_reply(
        "Vi har tagit emot din förfrågan och återkommer med nästa steg inom kort."
    )

    category_prompt = (
        "Categorize this customer message into one of: "
        "Kapellforfragan, Allman fraga, Support/Service, Besoksforfragan.\n\n"
        f"{form_summary}\n\nOnly return the category name."
    )
    title_prompt = (
        "Create a short subject line (max 60 chars) for this customer message.\n\n"
        f"{form_summary}\n\nOnly return the title."
    )
    response_prompt = (
        "Skriv ett kort svenskt mejlsvar enligt systeminstruktionerna.\n"
        "Målet är att ta ärendet till nästa tydliga steg och öka chansen till avslut.\n\n"
        f"{form_summary}"
    )

    try:
        category_resp = get_openai_response(category_prompt, "You classify incoming service inquiries.", 0.6, 120)
        candidate = category_resp.strip()
        if candidate:
            category = candidate[:80]
    except Exception:
        pass

    try:
        title_resp = get_openai_response(title_prompt, "You create short and clear email subjects.", 0.6, 120)
        candidate = title_resp.strip().replace('"', "").replace("'", "")
        if candidate:
            title = candidate[:60] + ("..." if len(candidate) > 60 else "")
    except Exception:
        pass

    try:
        generated = get_openai_response(response_prompt, response_system_prompt, 0.6, 550, model=CHAT_MODEL)
        proposed_response = finalize_email_reply(generated)
    except Exception:
        proposed_response = finalize_email_reply(proposed_response)

    return category, title, proposed_response


def save_submission_record(submission: Dict[str, Any]) -> None:
    db = get_db()
    if db:
        try:
            timestamp = submission.get("timestamp")
            if isinstance(timestamp, str):
                try:
                    parsed_ts = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
                except Exception:
                    parsed_ts = datetime.utcnow()
            elif isinstance(timestamp, datetime):
                parsed_ts = timestamp
            else:
                parsed_ts = datetime.utcnow()
            db_obj = FormSubmission(
                id=submission["id"],
                form_type=submission["form_type"],
                category=submission.get("category"),
                title=submission.get("title"),
                fields=submission.get("fields", {}),
                form_summary=submission.get("form_summary", ""),
                proposed_response=submission.get("proposed_response", ""),
                timestamp=parsed_ts,
                status=submission.get("status", "nya-inskick"),
                read=bool(submission.get("read", False)),
            )
            db.add(db_obj)
            db.commit()
            return
        except Exception:
            db.rollback()
        finally:
            db.close()

    records = read_json_file(FORM_SUBMISSIONS_FILE, [])
    if not isinstance(records, list):
        records = []
    records.append(submission)
    write_json_file(FORM_SUBMISSIONS_FILE, records)


def get_submission_notes(row: Dict[str, Any]) -> str:
    fields = row.get("fields", {})
    if isinstance(fields, dict):
        return str(fields.get("__internal_notes", "") or "")
    return ""


def get_mailgun_recipients() -> List[str]:
    if not MAILGUN_TO_RAW:
        return []
    recipients = [item.strip() for item in MAILGUN_TO_RAW.split(",")]
    return [item for item in recipients if item]


FIELD_LABELS_SV: Dict[str, str] = {
    "name": "Namn",
    "email": "E-post",
    "phone": "Telefonnummer",
    "address": "Adress",
    "postal_code": "Postnummer",
    "city": "Ort",
    "boat_brand": "Båtmärke",
    "boat_model": "Båtmodell",
    "boat_year": "Årsmodell",
    "home_port": "Hemmahamn",
    "wants_cover": "Önskar kapell",
    "wants_fender_socks": "Önskar fenderstrumpor",
    "size": "Storlek",
    "quantity": "Antal",
    "subject": "Ämne",
    "message": "Meddelande",
}

FORM_TYPE_LABELS_SV: Dict[str, str] = {
    "Kapellforfragan": "Kapellförfrågan",
    "Fenderforfragan": "Fenderförfrågan",
    "Kontakt": "Kontaktärende",
}

FIELD_ORDER = [
    "name", "email", "phone", "address", "postal_code", "city",
    "boat_brand", "boat_model", "boat_year", "home_port",
    "wants_cover", "wants_fender_socks", "size", "quantity",
    "subject", "message",
]


def _label(key: str) -> str:
    return FIELD_LABELS_SV.get(key) or key.replace("_", " ").capitalize()


def _humanize_value(value: Any) -> str:
    if isinstance(value, bool):
        return "Ja" if value else "Nej"
    if value is None:
        return ""
    s = str(value).strip()
    if s.lower() in ("true", "yes"):
        return "Ja"
    if s.lower() in ("false", "no"):
        return "Nej"
    return s


def build_notification_html(form_type: str, fields: Dict[str, Any], submission_id: str, timestamp_iso: str) -> str:
    form_label = html.escape(FORM_TYPE_LABELS_SV.get(form_type, form_type))

    # Build ordered rows, then any remaining keys not in FIELD_ORDER
    ordered_keys = [k for k in FIELD_ORDER if k in fields]
    extra_keys = [k for k in fields if k not in FIELD_ORDER and k != "__submitted_via"]
    all_keys = ordered_keys + extra_keys

    rows_html = ""
    for i, key in enumerate(all_keys):
        raw = fields.get(key, "")
        val = _humanize_value(raw)
        if not val:
            continue
        bg = "#ffffff" if i % 2 == 0 else "#f8f9fb"
        label_cell = (
            f"<td style='padding:11px 16px;border-bottom:1px solid #e8edf3;"
            f"background:{bg};font-weight:600;color:#4a5568;"
            f"font-size:13px;width:38%;white-space:nowrap;'>"
            f"{html.escape(_label(key))}</td>"
        )
        val_cell = (
            f"<td style='padding:11px 16px;border-bottom:1px solid #e8edf3;"
            f"background:{bg};color:#1a202c;font-size:14px;"
            f"word-break:break-word;'>{html.escape(val)}</td>"
        )
        rows_html += f"<tr>{label_cell}{val_cell}</tr>"

    if not rows_html:
        rows_html = (
            "<tr><td colspan='2' style='padding:12px 16px;color:#718096;"
            "font-style:italic;'>Inga fält</td></tr>"
        )

    # Format timestamp nicely
    try:
        from datetime import datetime, timezone
        dt = datetime.fromisoformat(timestamp_iso.replace("Z", "+00:00"))
        local_str = dt.strftime("%d %b %Y, %H:%M") + " UTC"
    except Exception:
        local_str = html.escape(timestamp_iso)

    return f"""<!DOCTYPE html>
<html lang="sv">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;padding:32px 16px;">
<tr><td align="center">
<table width="100%" style="max-width:580px;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(10,29,51,0.12);">

  <!-- Header -->
  <tr>
    <td style="background:linear-gradient(135deg,#0f2945 0%,#0a1d33 100%);padding:28px 32px;text-align:center;">
      <div style="display:inline-block;background:linear-gradient(145deg,#c9a24a,#a8832d);border-radius:10px;padding:8px 14px;margin-bottom:14px;">
        <span style="color:#0a1d33;font-weight:800;font-size:13px;letter-spacing:0.1em;">HENRICSSONS</span>
      </div>
      <div style="color:#ffffff;font-size:22px;font-weight:700;margin-bottom:4px;">Ny {form_label}</div>
      <div style="color:rgba(255,255,255,0.6);font-size:13px;">{local_str}</div>
    </td>
  </tr>

  <!-- Fields table -->
  <tr>
    <td style="background:#ffffff;padding:0;">
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        {rows_html}
      </table>
    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="background:#f8f9fb;padding:18px 32px;border-top:1px solid #e8edf3;">
      <p style="margin:0;color:#a0aec0;font-size:12px;text-align:center;">
        Referens-ID: {html.escape(submission_id)}<br>
        Henricssonsbåtkapell.se — automatiskt meddelande
      </p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>"""


def send_mailgun_email(*, recipients: List[str], subject: str, text_body: str, html_body: str) -> Tuple[bool, str]:
    if not MAILGUN_DOMAIN:
        return False, "MAILGUN_DOMAIN missing"
    if not MAILGUN_API_KEY:
        return False, "MAILGUN_API_KEY missing"
    if not MAILGUN_FROM:
        return False, "MAILGUN_FROM missing"
    if not recipients:
        return False, "MAILGUN_TO missing/empty"

    try:
        response = requests.post(
            f"{MAILGUN_API_BASE}/v3/{MAILGUN_DOMAIN}/messages",
            auth=("api", MAILGUN_API_KEY),
            data={
                "from": MAILGUN_FROM,
                "to": recipients,
                "subject": subject,
                "text": text_body,
                "html": html_body,
            },
            timeout=15,
        )
        if response.status_code >= 400:
            return False, f"HTTP {response.status_code}: {response.text}"
        return True, response.text.strip()
    except Exception as exc:
        return False, str(exc)


def send_mailgun_submission_notification(submission: Dict[str, Any]) -> None:
    recipients = get_mailgun_recipients()
    form_type = str(submission.get("form_type", "Kontakt"))
    fields = submission.get("fields", {})
    if not isinstance(fields, dict):
        fields = {}
    submission_id = str(submission.get("id", ""))
    timestamp_iso = str(submission.get("timestamp", ""))
    form_label = FORM_TYPE_LABELS_SV.get(form_type, form_type)
    subject = f"Ny {form_label} — Henricssons"
    field_lines = "\n".join(
        f"  {_label(k)}: {_humanize_value(v)}"
        for k, v in fields.items()
        if k != "__submitted_via" and _humanize_value(v)
    )
    text_body = (
        f"Ny {form_label}\n"
        f"{'=' * (len(form_label) + 4)}\n\n"
        f"{field_lines}\n\n"
        f"Tid (UTC): {timestamp_iso}\n"
        f"ID: {submission_id}\n"
    )
    html_body = build_notification_html(form_type, fields, submission_id, timestamp_iso)
    ok, info = send_mailgun_email(recipients=recipients, subject=subject, text_body=text_body, html_body=html_body)
    if not ok:
        print(f"Mailgun notification failed: {info}")


def process_form_submission(form_type: str, fields: Dict[str, Any], submitted_via: str = "web_form") -> str:
    normalized_form_type = display_form_type(form_type)
    safe_fields = sanitize_fields(fields, submitted_via=submitted_via)
    form_summary = build_form_summary(normalized_form_type, safe_fields)
    category, title, proposed_response = generate_submission_metadata(normalized_form_type, safe_fields, form_summary)
    submission_id = f"form_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{os.urandom(4).hex()}"
    submission = {
        "id": submission_id,
        "form_type": normalized_form_type,
        "category": category,
        "title": title,
        "fields": safe_fields,
        "form_summary": form_summary,
        "proposed_response": proposed_response,
        "timestamp": datetime.utcnow().isoformat(),
        "status": "nya-inskick",
        "read": False,
        "submitted_via": submitted_via,
    }
    save_submission_record(submission)
    send_mailgun_submission_notification(submission)
    return submission_id


def get_all_submissions() -> List[Dict[str, Any]]:
    file_rows = read_json_file(FORM_SUBMISSIONS_FILE, [])
    if not isinstance(file_rows, list):
        file_rows = []
    file_normalized: List[Dict[str, Any]] = []
    for row in file_rows:
        if not isinstance(row, dict):
            continue
        copy_row = dict(row)
        if "submitted_via" not in copy_row:
            if isinstance(copy_row.get("fields"), dict):
                copy_row["submitted_via"] = copy_row["fields"].get("__submitted_via", "web_form")
            else:
                copy_row["submitted_via"] = "web_form"
        copy_row["notes"] = get_submission_notes(copy_row)
        file_normalized.append(copy_row)

    db = get_db()
    if db:
        try:
            rows = db.query(FormSubmission).order_by(FormSubmission.timestamp.desc()).all()
            db_rows = [row.to_dict() for row in rows]
            merged: Dict[str, Dict[str, Any]] = {}
            for row in file_normalized:
                row_id = str(row.get("id", "")).strip()
                if row_id:
                    merged[row_id] = row
            for row in db_rows:
                row_id = str(row.get("id", "")).strip()
                if row_id:
                    merged[row_id] = row
            merged_rows = list(merged.values())
            merged_rows.sort(key=lambda x: str(x.get("timestamp", "")), reverse=True)
            return merged_rows
        except Exception:
            pass
        finally:
            db.close()
    file_normalized.sort(key=lambda x: str(x.get("timestamp", "")), reverse=True)
    return file_normalized


def update_submission_status_record(submission_id: str, status: Optional[str], read: Optional[bool]) -> bool:
    updated = False
    db = get_db()
    if db:
        try:
            row = db.query(FormSubmission).filter_by(id=submission_id).first()
            if row:
                if status is not None:
                    row.status = status
                if read is not None:
                    row.read = read
                db.commit()
                updated = True
        except Exception:
            db.rollback()
        finally:
            db.close()
    if updated:
        return True

    rows = read_json_file(FORM_SUBMISSIONS_FILE, [])
    if not isinstance(rows, list):
        return False
    found = False
    for row in rows:
        if isinstance(row, dict) and row.get("id") == submission_id:
            if status is not None:
                row["status"] = status
            if read is not None:
                row["read"] = read
            found = True
            break
    if found:
        write_json_file(FORM_SUBMISSIONS_FILE, rows)
    return found


def update_submission_notes_record(submission_id: str, notes: str) -> bool:
    sanitized_notes = str(notes or "").strip()
    updated = False
    db = get_db()
    if db:
        try:
            row = db.query(FormSubmission).filter_by(id=submission_id).first()
            if row:
                fields = row.fields if isinstance(row.fields, dict) else {}
                next_fields = dict(fields)
                if sanitized_notes:
                    next_fields["__internal_notes"] = sanitized_notes
                else:
                    next_fields.pop("__internal_notes", None)
                row.fields = next_fields
                db.commit()
                updated = True
        except Exception:
            db.rollback()
        finally:
            db.close()
    if updated:
        return True

    rows = read_json_file(FORM_SUBMISSIONS_FILE, [])
    if not isinstance(rows, list):
        return False
    found = False
    for row in rows:
        if isinstance(row, dict) and row.get("id") == submission_id:
            fields = row.get("fields", {})
            if not isinstance(fields, dict):
                fields = {}
            next_fields = dict(fields)
            if sanitized_notes:
                next_fields["__internal_notes"] = sanitized_notes
            else:
                next_fields.pop("__internal_notes", None)
            row["fields"] = next_fields
            row["notes"] = sanitized_notes
            found = True
            break
    if found:
        write_json_file(FORM_SUBMISSIONS_FILE, rows)
    return found


def delete_submission_record(submission_id: str) -> bool:
    deleted = False
    db = get_db()
    if db:
        try:
            row = db.query(FormSubmission).filter_by(id=submission_id).first()
            if row:
                db.delete(row)
                db.commit()
                deleted = True
        except Exception:
            db.rollback()
        finally:
            db.close()

    rows = read_json_file(FORM_SUBMISSIONS_FILE, [])
    if isinstance(rows, list):
        new_rows = [
            row
            for row in rows
            if not (isinstance(row, dict) and str(row.get("id", "")).strip() == submission_id)
        ]
        if len(new_rows) != len(rows):
            write_json_file(FORM_SUBMISSIONS_FILE, new_rows)
            deleted = True
    return deleted

def normalize_image_rel_path(rel_path: str) -> str:
    rel = (rel_path or "").replace("\\", "/").strip()
    rel = rel.lstrip("/")
    if not rel:
        raise ValueError("Empty rel_path")
    if rel.startswith("..") or "/../" in f"/{rel}/":
        raise ValueError("Invalid rel_path")
    return rel


def secure_image_destination(rel_path: str, ext: str) -> Tuple[Path, str]:
    rel = normalize_image_rel_path(rel_path)
    if ext and not rel.lower().endswith(ext):
        rel += ext
    abs_path = (IMAGES_ROOT / rel).resolve()
    if IMAGES_ROOT not in abs_path.parents:
        raise ValueError("Invalid image path")
    if abs_path.suffix.lower() not in ALLOWED_IMAGE_EXTS:
        raise ValueError("Invalid image extension")
    return abs_path, rel


REQUIRED_DRAFT_FIELDS: Dict[str, List[str]] = {
    "Kapellforfragan": ["name", "phone", "email", "manufacturer", "model", "boat_year", "home_port"],
    "Fenderforfragan": ["name", "phone", "email", "quantity", "size"],
    "Kontakt": ["name", "email", "subject", "message"],
}

OPTIONAL_DRAFT_FIELDS: Dict[str, List[str]] = {
    "Kapellforfragan": ["old_canopy", "message"],
    "Fenderforfragan": ["address"],
    "Kontakt": ["phone"],
}

FIELD_LABELS: Dict[str, str] = {
    "name": "Namn",
    "phone": "Telefonnummer",
    "email": "E-postadress",
    "manufacturer": "Tillverkare",
    "model": "Modell",
    "message": "Meddelande",
    "subject": "Ämne",
    "quantity": "Antal",
    "size": "Storlek",
    "address": "Adress",
    "boat_year": "Årsmodell",
    "home_port": "Hemmahamn",
    "old_canopy": "Tillverkare av befintligt kapell",
}

FIELD_LABELS_EN: Dict[str, str] = {
    "name": "Name",
    "phone": "Phone number",
    "email": "Email",
    "manufacturer": "Manufacturer",
    "model": "Model",
    "message": "Message",
    "subject": "Subject",
    "quantity": "Quantity",
    "size": "Size",
    "address": "Address",
    "boat_year": "Year model",
    "home_port": "Home port",
    "old_canopy": "Current canopy manufacturer",
}

DRAFT_KEY_ALIASES: Dict[str, str] = {
    "name": "name",
    "namn": "name",
    "telefon": "phone",
    "telefonnummer": "phone",
    "phone": "phone",
    "epost": "email",
    "e-post": "email",
    "e-postadress": "email",
    "email": "email",
    "tillverkare": "manufacturer",
    "manufacturer": "manufacturer",
    "modell": "model",
    "model": "model",
    "amne": "subject",
    "subject": "subject",
    "meddelande": "message",
    "ovrig_information": "message",
    "ovriginformation": "message",
    "ovriga_onskemal": "message",
    "message": "message",
    "antal": "quantity",
    "quantity": "quantity",
    "storlek": "size",
    "size": "size",
    "adress": "address",
    "address": "address",
    "arsmodell": "boat_year",
    "hemmahamn": "home_port",
    "tillverkare_av_befintligt_kapell": "old_canopy",
}

INTENT_FIELD_ORDER: Dict[str, List[str]] = {
    "Kapellforfragan": ["name", "phone", "email", "manufacturer", "model", "boat_year", "home_port", "old_canopy", "message"],
    "Fenderforfragan": ["name", "phone", "email", "address", "quantity", "size"],
    "Kontakt": ["name", "email", "phone", "subject", "message"],
}
VALID_INTENTS = {"Kapellforfragan", "Fenderforfragan", "Kontakt"}
ALL_DRAFT_FIELDS = list(dict.fromkeys(INTENT_FIELD_ORDER["Kapellforfragan"] + INTENT_FIELD_ORDER["Fenderforfragan"] + INTENT_FIELD_ORDER["Kontakt"]))
ASSISTANT_COMMAND_START = "[[CMD]]"
ASSISTANT_COMMAND_END = "[[/CMD]]"


def canonicalize_draft_key(value: str) -> str:
    text = (value or "").strip().lower()
    if not text:
        return ""
    text = re.sub(r"^\d+\.\s*", "", text)
    text = text.replace("å", "a").replace("ä", "a").replace("ö", "o")
    text = text.replace("-", "_").replace(" ", "_")
    text = re.sub(r"[^a-z0-9_]", "", text)
    return DRAFT_KEY_ALIASES.get(text, text)


def normalize_draft(intent: str, draft: Dict[str, Any]) -> Dict[str, str]:
    result: Dict[str, str] = {}
    order = INTENT_FIELD_ORDER.get(intent, ALL_DRAFT_FIELDS)
    allowed_keys = set(order)
    for key in order:
        value = str(draft.get(key, "") or "").strip()[:1000]
        if value:
            result[key] = value
    for raw_key, raw_value in draft.items():
        key = canonicalize_draft_key(str(raw_key))
        if not key or key not in allowed_keys:
            continue
        value = str(raw_value or "").strip()[:1000]
        if value:
            result[key] = value
    return result


def compute_missing_fields(intent: str, draft: Dict[str, Any]) -> List[str]:
    if intent not in VALID_INTENTS:
        return []
    normalized = normalize_draft(intent, draft)
    required = REQUIRED_DRAFT_FIELDS.get(intent, [])
    missing: List[str] = []
    for key in required:
        value = str(normalized.get(key, "") or "").strip()
        if not value:
            missing.append(key)
    return missing


def normalize_model_missing_fields(raw_missing: Any, intent: str) -> List[str]:
    if not isinstance(raw_missing, list):
        return []
    allowed = set(REQUIRED_DRAFT_FIELDS.get(intent, ALL_DRAFT_FIELDS))
    normalized: List[str] = []
    seen: set[str] = set()
    for item in raw_missing:
        key = canonicalize_draft_key(str(item))
        if not key or key not in allowed or key in seen:
            continue
        normalized.append(key)
        seen.add(key)
    return normalized


def normalize_intent(value: str) -> str:
    text = (value or "").strip().lower()
    if "fender" in text:
        return "Fenderforfragan"
    if "kapell" in text:
        return "Kapellforfragan"
    if "kontakt" in text or "contact" in text:
        return "Kontakt"
    return ""


def normalize_text_for_match(value: str) -> str:
    text = str(value or "").lower()
    text = text.replace("å", "a").replace("ä", "a").replace("ö", "o")
    return text


def ensure_confirmation_question(reply: str, language: str = "sv") -> str:
    text = str(reply or "").strip()
    if not text:
        return text
    lang = "en" if language == "en" else "sv"
    normalized = normalize_text_for_match(text)
    if lang == "en":
        patterns = (
            r"\bis this correct\b",
            r"\bdoes this look right\b",
            r"\bshall i send\b",
            r"\bshould i send\b",
            r"\bconfirm\b",
        )
        suffix = "Is this correct?"
    else:
        patterns = (
            r"\bstammer detta\b",
            r"\bar detta korrekt\b",
            r"\blater det ratt\b",
            r"\bska jag skicka\b",
            r"\bvill du att jag skickar\b",
            r"\bbekrafta\b",
        )
        suffix = "Stämmer detta?"
    if "?" in text and any(re.search(pattern, normalized, re.IGNORECASE) for pattern in patterns):
        return text
    return f"{text}\n\n{suffix}"


def sanitize_visible_reply_text(reply: str) -> str:
    text = str(reply or "")
    if not text:
        return text
    # Never expose long dashes in visible chat text.
    text = text.replace("—", "-").replace("–", "-")
    return text


ROUTE_REPLY_TOKENS = {
    "Kapellforfragan": "%kapellförfrågan%",
    "Fenderforfragan": "%fenderförfrågan%",
    "Kontakt": "%kontakt%",
}


def detect_intent_from_draft(draft: Dict[str, Any]) -> str:
    if not isinstance(draft, dict):
        return ""
    normalized = {canonicalize_draft_key(str(k)): str(v or "").strip() for k, v in draft.items()}
    if any(normalized.get(key) for key in ("quantity", "size", "address")):
        return "Fenderforfragan"
    if any(normalized.get(key) for key in ("manufacturer", "model", "boat_year", "home_port", "old_canopy")):
        return "Kapellforfragan"
    if any(normalized.get(key) for key in ("subject", "message")):
        return "Kontakt"
    return ""


def map_draft_to_submission(intent: str, draft: Dict[str, Any]) -> Tuple[str, Dict[str, str]]:
    normalized = normalize_draft(intent, draft)
    if intent == "Kapellforfragan":
        return (
            "Kapellförfrågan",
            {
                "1. Namn": str(normalized.get("name", "")).strip(),
                "2. Telefonnummer": str(normalized.get("phone", "")).strip(),
                "3. E-postadress": str(normalized.get("email", "")).strip(),
                "4. Tillverkare": str(normalized.get("manufacturer", "")).strip(),
                "5. Modell": str(normalized.get("model", "")).strip(),
                "6. Årsmodell": str(normalized.get("boat_year", "")).strip(),
                "7. Hemmahamn": str(normalized.get("home_port", "")).strip(),
                "8. Tillverkare av befintligt kapell": str(normalized.get("old_canopy", "")).strip(),
                "9. Övrig information": str(normalized.get("message", "")).strip(),
            },
        )
    if intent == "Fenderforfragan":
        return (
            "Fenderförfrågan",
            {
                "1. Namn": str(normalized.get("name", "")).strip(),
                "2. Telefon": str(normalized.get("phone", "")).strip(),
                "3. E-post": str(normalized.get("email", "")).strip(),
                "4. Adress": str(normalized.get("address", "")).strip(),
                "5. Antal": str(normalized.get("quantity", "")).strip(),
                "6. Storlek": str(normalized.get("size", "")).strip(),
            },
        )
    return (
        "Kontakt",
        {
            "1. Namn": str(normalized.get("name", "")).strip(),
            "2. E-postadress": str(normalized.get("email", "")).strip(),
            "3. Telefonnummer": str(normalized.get("phone", "")).strip(),
            "4. Ämne": str(normalized.get("subject", "")).strip(),
            "5. Meddelande": str(normalized.get("message", "")).strip(),
        },
    )


@app.after_request
def add_cors_headers(response):
    origin = request.headers.get("Origin", "")
    if origin and (origin in ALLOWED_ORIGINS or origin.startswith("http://localhost") or origin.startswith("http://127.0.0.1")):
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, X-Admin-Key, Authorization"

    # Force UTF-8 charset for textual responses to avoid mojibake in browsers.
    mimetype = (response.mimetype or "").lower()
    content_type = response.headers.get("Content-Type", "")
    if "charset=" not in content_type.lower() and mimetype in {
        "text/html",
        "text/css",
        "application/javascript",
        "text/javascript",
        "application/json",
    }:
        response.headers["Content-Type"] = f"{response.mimetype}; charset=utf-8"

    path_lower = (request.path or "").lower()
    if request.method == "GET" and not path_lower.startswith("/api/"):
        if path_lower == "/" or path_lower.endswith((".html", ".js", ".css", ".json")):
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
    return response


@app.route("/api/<path:path>", methods=["OPTIONS"])
def options(path: str):
    return "", 200


@app.route("/api/save_boatdata", methods=["POST"])
@admin_required
def save_boatdata():
    data = request.get_json()
    if not isinstance(data, dict):
        return jsonify(error="Invalid payload"), 400
    write_json_file(BOAT_DATA_FILE, data)
    set_site_content("boat_data", data)
    return jsonify(success=True)


@app.route("/api/save_models_meta", methods=["POST"])
@admin_required
def save_models_meta():
    data = request.get_json()
    if not isinstance(data, dict):
        return jsonify(error="Invalid payload"), 400
    write_json_file(MODELS_META_FILE, data)
    set_site_content("models_meta", data)
    return jsonify(success=True)


@app.route("/api/submit_form", methods=["POST", "OPTIONS"])
def submit_form():
    if request.method == "OPTIONS":
        return "", 200
    payload = request.get_json()
    if not isinstance(payload, dict):
        return jsonify(error="Form data required"), 400
    fields = payload.get("fields", {})
    if not isinstance(fields, dict):
        return jsonify(error="Invalid fields"), 400
    form_type = payload.get("form_type", "Kontakt")
    submitted_via = str(payload.get("submitted_via", "web_form") or "web_form")
    try:
        submission_id = process_form_submission(form_type, fields, submitted_via=submitted_via)
        return jsonify(success=True, submission_id=submission_id)
    except Exception as exc:
        return jsonify(error=f"Server error: {exc}"), 500


@app.route("/api/get_form_submissions", methods=["GET"])
@admin_required
def get_form_submissions():
    return jsonify(get_all_submissions())


@app.route("/api/update_submission_status", methods=["POST"])
@admin_required
def update_submission_status_route():
    payload = request.get_json()
    if not isinstance(payload, dict):
        return jsonify(error="Invalid payload"), 400
    submission_id = str(payload.get("id", "")).strip()
    if not submission_id:
        return jsonify(error="Missing id"), 400
    new_status = payload.get("status")
    if new_status is not None and new_status not in STATUS_FLOW:
        return jsonify(error="Invalid status"), 400
    read_value = payload.get("read")
    if read_value is not None:
        read_value = bool(read_value)
    updated = update_submission_status_record(submission_id, new_status, read_value)
    if not updated:
        return jsonify(error="Submission not found"), 404
    return jsonify(success=True)


@app.route("/api/delete_submission", methods=["POST"])
@admin_required
def delete_submission_route():
    payload = request.get_json()
    if not isinstance(payload, dict):
        return jsonify(error="Invalid payload"), 400
    submission_id = str(payload.get("id", "")).strip()
    if not submission_id:
        return jsonify(error="Missing id"), 400
    deleted = delete_submission_record(submission_id)
    if not deleted:
        return jsonify(error="Submission not found"), 404
    return jsonify(success=True)


@app.route("/api/update_submission_notes", methods=["POST"])
@admin_required
def update_submission_notes_route():
    payload = request.get_json()
    if not isinstance(payload, dict):
        return jsonify(error="Invalid payload"), 400
    submission_id = str(payload.get("id", "")).strip()
    if not submission_id:
        return jsonify(error="Missing id"), 400
    notes = str(payload.get("notes", "") or "")
    updated = update_submission_notes_record(submission_id, notes)
    if not updated:
        return jsonify(error="Submission not found"), 404
    return jsonify(success=True, notes=notes.strip())


@app.route("/api/form_prompts", methods=["GET", "POST"])
@admin_required
def form_prompts():
    if request.method == "GET":
        prompts = load_form_prompts()
        return jsonify(
            {
                "Kapellförfrågan": prompts.get("Kapellforfragan", DEFAULT_FORM_PROMPTS["Kapellforfragan"]),
                "Fenderförfrågan": prompts.get("Fenderforfragan", DEFAULT_FORM_PROMPTS["Fenderforfragan"]),
                "Kontakt": prompts.get("Kontakt", DEFAULT_FORM_PROMPTS["Kontakt"]),
            }
        )
    data = request.get_json()
    if not isinstance(data, dict):
        return jsonify(error="Invalid payload"), 400
    save_form_prompts(data)
    return jsonify(success=True)


@app.route("/api/ai_settings", methods=["GET", "POST"])
@admin_required
def ai_settings():
    if request.method == "GET":
        ai_data = load_ai_settings()
        prompts = load_form_prompts()
        return jsonify(
            {
                "admin_chat_prompt": ai_data.get("admin_chat_prompt", DEFAULT_ADMIN_CHAT_PROMPT),
                "assistant_system_prompt": ai_data.get("assistant_system_prompt", DEFAULT_PUBLIC_ASSISTANT_PROMPT.strip()),
                "form_prompts": {
                    "Kapellförfrågan": prompts.get("Kapellforfragan", DEFAULT_FORM_PROMPTS["Kapellforfragan"]),
                    "Fenderförfrågan": prompts.get("Fenderforfragan", DEFAULT_FORM_PROMPTS["Fenderforfragan"]),
                    "Kontakt": prompts.get("Kontakt", DEFAULT_FORM_PROMPTS["Kontakt"]),
                },
            }
        )

    data = request.get_json()
    if not isinstance(data, dict):
        return jsonify(error="Invalid payload"), 400

    ai_payload = {}
    if "admin_chat_prompt" in data:
        ai_payload["admin_chat_prompt"] = data.get("admin_chat_prompt")
    if "assistant_system_prompt" in data:
        ai_payload["assistant_system_prompt"] = data.get("assistant_system_prompt")
    if ai_payload:
        save_ai_settings(ai_payload)

    form_payload = data.get("form_prompts")
    if isinstance(form_payload, dict):
        save_form_prompts(form_payload)

    return jsonify(success=True)


@app.route("/api/page_texts", methods=["GET", "POST"])
def page_texts():
    if request.method == "GET":
        data = get_site_content("page_texts")
        if isinstance(data, dict):
            return jsonify(data)
        file_data = read_json_file(PAGE_TEXTS_FILE, None)
        if isinstance(file_data, dict):
            return jsonify(file_data)
        return jsonify(
            {
                "announcement": {
                    "text": "## Ny lokal i Kungsbacka\n\nVi har flyttat till storre lokaler i Varla industriomrade."
                }
            }
        )

    if not check_admin_access():
        return jsonify(error="Admin authorization required"), 403
    data = request.get_json()
    if not isinstance(data, dict):
        return jsonify(error="Invalid payload"), 400
    write_json_file(PAGE_TEXTS_FILE, data)
    set_site_content("page_texts", data)
    return jsonify(success=True)

@app.route("/api/upload_image", methods=["POST"])
@admin_required
def upload_image():
    payload = request.get_json()
    if not isinstance(payload, dict):
        return jsonify(error="Invalid payload"), 400
    data_url = str(payload.get("data", ""))
    rel_path = str(payload.get("rel_path", ""))
    if not data_url or not rel_path:
        return jsonify(error="data and rel_path required"), 400

    match = re.match(r"^data:image/(jpeg|jpg|png|webp);base64,(.+)$", data_url, re.IGNORECASE | re.DOTALL)
    if not match:
        return jsonify(error="Unsupported image format"), 400
    ext_map = {"jpeg": ".jpg", "jpg": ".jpg", "png": ".png", "webp": ".webp"}
    ext = ext_map[match.group(1).lower()]
    b64_data = match.group(2).strip()
    try:
        raw = base64.b64decode(b64_data, validate=True)
    except Exception:
        return jsonify(error="Invalid base64 image data"), 400
    if len(raw) > MAX_UPLOAD_BYTES:
        return jsonify(error="Image too large"), 400

    try:
        abs_path, safe_rel_path = secure_image_destination(rel_path, ext)
    except ValueError as exc:
        return jsonify(error=str(exc)), 400

    abs_path.parent.mkdir(parents=True, exist_ok=True)
    with abs_path.open("wb") as handle:
        handle.write(raw)

    return jsonify(success=True, saved_path=safe_rel_path.replace("/", "\\"))


@app.route("/api/mailgun_test", methods=["POST"])
@admin_required
def mailgun_test():
    payload = request.get_json(silent=True) or {}
    recipients = get_mailgun_recipients()
    override_to = payload.get("to")
    if isinstance(override_to, str) and override_to.strip():
        recipients = [item.strip() for item in override_to.split(",") if item.strip()]
    subject = str(payload.get("subject", "Henricssons Mailgun test")).strip() or "Henricssons Mailgun test"
    text_body = str(payload.get("text", "Testmail från Henricssons backend.")).strip() or "Testmail från Henricssons backend."
    html_body = f"<p>{html.escape(text_body)}</p>"
    ok, info = send_mailgun_email(recipients=recipients, subject=subject, text_body=text_body, html_body=html_body)
    if not ok:
        return jsonify(success=False, error=info), 400
    return jsonify(success=True, provider_response=info)


@app.route("/boat_data.json")
def get_boat_data():
    data = get_site_content("boat_data")
    if isinstance(data, dict):
        return jsonify(data)
    if BOAT_DATA_FILE.exists():
        return send_from_directory(str(BASE_DIR), "boat_data.json")
    return jsonify({})


@app.route("/henricssons_bilder/<path:filename>")
def get_henricssons_files(filename: str):
    if filename == "models_meta.json":
        data = get_site_content("models_meta")
        if isinstance(data, dict):
            return app.response_class(json.dumps(data, ensure_ascii=False), mimetype="application/json")
        if MODELS_META_FILE.exists():
            return send_from_directory(str(IMAGES_ROOT), "models_meta.json")
        return jsonify({})

    full_path = (IMAGES_ROOT / filename).resolve()
    if IMAGES_ROOT not in full_path.parents:
        return jsonify(error="Invalid path"), 400
    if full_path.exists() and full_path.is_file():
        return send_from_directory(str(full_path.parent), full_path.name)
    return jsonify(error="File not found"), 404


@app.route("/api/chat", methods=["POST", "OPTIONS"])
@admin_required
def chat():
    if request.method == "OPTIONS":
        return "", 200
    payload = request.get_json()
    if not isinstance(payload, dict):
        return jsonify(error="Invalid payload"), 400
    message = str(payload.get("message", "")).strip()
    settings = load_ai_settings()
    fallback_prompt = settings.get("admin_chat_prompt", DEFAULT_ADMIN_CHAT_PROMPT)
    custom_prompt = str(payload.get("prompt", "")).strip() or fallback_prompt
    if not message:
        return jsonify(error="Message required"), 400
    try:
        answer = get_openai_response(message, custom_prompt, 0.6, 550, model=CHAT_MODEL)
        return jsonify(success=True, response=answer)
    except Exception as exc:
        return jsonify(error=str(exc)), 500


@app.route("/api/assistant_chat", methods=["POST", "OPTIONS"])
def assistant_chat():
    if request.method == "OPTIONS":
        return "", 200
    payload = request.get_json()
    if not isinstance(payload, dict):
        return jsonify(error="Invalid payload"), 400

    message = str(payload.get("message", "")).strip()
    if not message:
        return jsonify(error="Message required"), 400
    incoming_history = payload.get("history", [])
    if not isinstance(incoming_history, list):
        incoming_history = []
    draft = payload.get("draft", {})
    if not isinstance(draft, dict):
        draft = {}
    payload_intent = normalize_intent(str(payload.get("intent", "")))
    if payload_intent in VALID_INTENTS:
        draft = normalize_draft(payload_intent, draft)
    else:
        draft = normalize_draft("", draft)
    explicit_confirmation = bool(payload.get("confirmed", False))
    requested_language = str(payload.get("language", "")).strip().lower()
    if requested_language not in {"sv", "en"}:
        requested_language = "sv"

    request_blob = {
        "message": message,
        "history": incoming_history[-20:],
        "state": {
            "intent": payload_intent if payload_intent in VALID_INTENTS else "",
            "draft": draft,
            "confirmed": explicit_confirmation,
            "language": requested_language,
        },
        "command_protocol": {
            "start": ASSISTANT_COMMAND_START,
            "end": ASSISTANT_COMMAND_END,
            "description": "State update command appended after visible chat text.",
        },
        "ui_hints": {
            "fender_size": {
                "input_mode": "dropdown",
                "free_text_disallowed": True,
                "note_sv": "Storlek väljs av kunden i storleks-dropdownen i chatten.",
                "note_en": "Size is selected by the customer in the chat size dropdown.",
            },
            "route_actions": {
                "Kapellforfragan": "/kapellforfragan#contact-form",
                "Fenderforfragan": "/tillbehor#fenderForm",
                "Kontakt": "/kontakt#contactForm",
            },
        },
        "field_spec": {
            "Kapellforfragan": {
                "required": REQUIRED_DRAFT_FIELDS["Kapellforfragan"],
                "optional": OPTIONAL_DRAFT_FIELDS["Kapellforfragan"],
                "labels_sv": {
                    "name": "Namn",
                    "phone": "Telefonnummer",
                    "email": "E-postadress",
                    "manufacturer": "Tillverkare",
                    "model": "Modell",
                    "boat_year": "Årsmodell",
                    "home_port": "Hemmahamn",
                    "old_canopy": "Tillverkare av befintligt kapell",
                    "message": "Meddelande",
                },
                "labels_en": {
                    "name": "Name",
                    "phone": "Phone number",
                    "email": "Email",
                    "manufacturer": "Manufacturer",
                    "model": "Model",
                    "boat_year": "Year model",
                    "home_port": "Home port",
                    "old_canopy": "Current canopy manufacturer",
                    "message": "Message",
                },
            },
            "Fenderforfragan": {
                "required": REQUIRED_DRAFT_FIELDS["Fenderforfragan"],
                "optional": OPTIONAL_DRAFT_FIELDS["Fenderforfragan"],
                "labels_sv": {
                    "name": "Namn",
                    "phone": "Telefonnummer",
                    "email": "E-postadress",
                    "quantity": "Antal",
                    "size": "Storlek",
                    "address": "Adress",
                },
                "labels_en": {
                    "name": "Name",
                    "phone": "Phone number",
                    "email": "Email",
                    "quantity": "Quantity",
                    "size": "Size",
                    "address": "Address",
                },
            },
            "Kontakt": {
                "required": REQUIRED_DRAFT_FIELDS["Kontakt"],
                "optional": OPTIONAL_DRAFT_FIELDS["Kontakt"],
                "labels_sv": {
                    "name": "Namn",
                    "email": "E-postadress",
                    "subject": "Ämne",
                    "message": "Meddelande",
                    "phone": "Telefonnummer",
                },
                "labels_en": {
                    "name": "Name",
                    "email": "Email",
                    "subject": "Subject",
                    "message": "Message",
                    "phone": "Phone number",
                },
            },
        },
    }

    settings = load_ai_settings()
    assistant_system_prompt = settings.get("assistant_system_prompt", DEFAULT_PUBLIC_ASSISTANT_PROMPT.strip())
    enforcement_suffix = (
        "\n\nCommand protocol requirements:\n"
        f"- Visible reply must be normal user-facing chat text.\n"
        "- Visible reply text is mandatory and cannot be empty.\n"
        "- Critical style rule: never use em dash (—) or en dash (–) in visible text; use '-' or ':' or '.' instead.\n"
        "- Answer customer questions directly in chat whenever possible.\n"
        "- Never pretend to book, reserve, schedule, confirm a visit, confirm a time slot, or perform any real-world action.\n"
        "- Never claim you checked availability, a calendar, opening hours, or staff presence unless that exact information is explicitly present in the provided context.\n"
        "- If the customer suggests a time or visit, do not confirm it as booked. State that it must be confirmed by the company.\n"
        "- Never ask the customer for contact details or other form fields in public chat.\n"
        "- Never use hidden command blocks or JSON in the reply.\n"
        "- Only show route buttons by writing one of these exact visible tokens on its own line at the end: %kapellförfrågan% or %fenderförfrågan% or %kontakt%.\n"
        "- Do not rely on hidden recommended_action or any other hidden command. Only the visible %...% token should trigger a button.\n"
    )
    user_prompt = json.dumps(request_blob, ensure_ascii=False)
    try:
        raw = get_openai_response(
            user_prompt,
            f"{assistant_system_prompt}\n{enforcement_suffix}",
            temperature=0.6,
            max_tokens=850,
            model=CHAT_MODEL,
        )
    except Exception as exc:
        return jsonify(error=f"AI unavailable: {exc}"), 502

    reply, model_command = split_visible_text_and_command(raw)
    if not str(reply or "").strip():
        try:
            repaired_reply, repaired_command = recover_visible_reply_from_model(
                assistant_system_prompt=assistant_system_prompt,
                raw_output=raw,
                customer_message=message,
                language=requested_language,
                model=CHAT_MODEL,
            )
            if str(repaired_reply or "").strip():
                reply = repaired_reply
                if not isinstance(model_command, dict) and isinstance(repaired_command, dict):
                    model_command = repaired_command
        except Exception:
            pass

    merged_draft: Dict[str, str] = {}
    intent = ""
    missing_fields: List[str] = []
    ready_to_submit = False
    needs_confirmation = False
    confirmed = False
    summary = ""
    submit_command: Optional[Dict[str, Any]] = None
    reply = str(reply or "").strip()
    if not reply:
        return jsonify(error="AI returned empty visible reply"), 502
    response_language = requested_language
    reply = sanitize_visible_reply_text(reply)

    return jsonify(
        {
            "success": True,
            "reply": reply,
            "intent": intent,
            "draft": merged_draft,
            "missing_fields": missing_fields,
            "needs_confirmation": needs_confirmation,
            "ready_to_submit": ready_to_submit,
            "confirmed": confirmed,
            "language": response_language,
            "summary": summary,
            "recommended_action": "",
            "submit_command": submit_command,
        }
    )


@app.route("/api/assistant_submit", methods=["POST", "OPTIONS"])
def assistant_submit():
    if request.method == "OPTIONS":
        return "", 200
    payload = request.get_json()
    if not isinstance(payload, dict):
        return jsonify(error="Invalid payload"), 400
    intent = normalize_intent(str(payload.get("intent", "")))
    if intent not in VALID_INTENTS:
        return jsonify(error="Invalid intent"), 400
    draft = payload.get("draft", {})
    if not isinstance(draft, dict):
        return jsonify(error="Invalid draft"), 400
    draft = normalize_draft(intent, draft)
    confirmed = bool(payload.get("confirmed", False))
    if not confirmed:
        return jsonify(error="Confirmation required before submit"), 400

    missing = compute_missing_fields(intent, draft)
    if missing:
        return jsonify(error="Missing required fields", missing_fields=missing), 400

    form_type, fields = map_draft_to_submission(intent, draft)
    try:
        submission_id = process_form_submission(form_type, fields, submitted_via="ai_chatbot")
        return jsonify(success=True, submission_id=submission_id, form_type=form_type)
    except Exception as exc:
        return jsonify(error=f"Could not submit form: {exc}"), 500


@app.route("/robots.txt", methods=["GET"])
def robots_txt():
    return Response(
        f"User-agent: *\nAllow: /\nSitemap: {PUBLIC_BASE_URL}/sitemap.xml\n",
        mimetype="text/plain",
    )


@app.route("/sitemap.xml", methods=["GET"])
def sitemap_xml():
    urls = [absolute_public_url(path) for path in CORE_PUBLIC_PATHS]
    urls.extend(absolute_public_url(f"/exempel/{item['canonical_slug']}") for item in list_canonical_examples())
    xml_lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ]
    seen: set[str] = set()
    for url in urls:
        if url in seen:
            continue
        seen.add(url)
        xml_lines.append("  <url>")
        xml_lines.append(f"    <loc>{html.escape(url)}</loc>")
        xml_lines.append("  </url>")
    xml_lines.append("</urlset>")
    return Response("\n".join(xml_lines), mimetype="application/xml")


@app.route("/search", methods=["GET"])
def search_page():
    query = str(request.args.get("q") or request.args.get("query") or "").strip()
    query_lower = query.lower()
    examples = list_canonical_examples()
    if query_lower:
        results = [
            item
            for item in examples
            if query_lower in " ".join(
                [
                    str(item.get("manufacturer", "")),
                    str(item.get("model", "")),
                    str(item.get("category", "")),
                    str(item.get("variant", "")),
                    str(item.get("description", "")),
                ]
            ).lower()
        ]
    else:
        results = examples[:48]

    result_items: List[str] = []
    for item in results[:120]:
        slug = str(item.get("canonical_slug", "") or "").strip()
        if not slug:
            continue
        title_text = " ".join(part for part in [str(item.get("manufacturer", "")).strip(), str(item.get("model", "")).strip()] if part).strip() or slug
        summary = str(item.get("description", "") or item.get("variant", "") or item.get("delivery", "") or GENERIC_EXAMPLE_DESCRIPTION).strip()
        result_items.append(
            f"""
            <article class="seo-search-item">
                <div class="seo-kicker">{html.escape(str(item.get('category', '') or 'Exempel'))}</div>
                <h2 style="margin:0; font-size:1.25rem;"><a href="/exempel/{html.escape(slug)}" style="color:inherit; text-decoration:none;">{html.escape(title_text)}</a></h2>
                <p style="margin:0; color:#5d5d5d;">{html.escape(summary[:260])}</p>
                <div><a class="seo-btn" href="/exempel/{html.escape(slug)}">Läs mer</a></div>
            </article>
            """
        )

    content_html = f"""
    <main class="seo-page">
        <section class="seo-hero">
            <div class="seo-breadcrumbs"><a href="/">Start</a><span>/</span><span>Search</span></div>
            <div class="seo-kicker">Search</div>
            <h1>Search results</h1>
            <p>Sök bland exempel på båtkapell, sprayhoods, hamnkapell och andra projekt från Henricssons Båtkapell.</p>
            <form class="seo-search-form" method="get" action="/search">
                <input type="search" name="q" value="{html.escape(query)}" placeholder="Sök båt, tillverkare eller modell"/>
                <button type="submit" class="seo-btn seo-btn-primary">Sök</button>
            </form>
            <p style="margin:0; color:#5d5d5d;">{len(results)} träffar{f" för '{html.escape(query)}'" if query else ''}.</p>
        </section>
        <section class="seo-search-list">
            {''.join(result_items) if result_items else '<div class="seo-card"><p style="margin:0;">Inga träffar hittades.</p></div>'}
        </section>
    </main>
    """
    return render_public_page(
        title="Search Results",
        description="Sök bland exempel och projekt från Henricssons Båtkapell.",
        canonical_path="/search",
        content_html=content_html,
    )


@app.route("/exempel/<path:slug>", methods=["GET"])
def example_page(slug: str):
    clean_slug = slug.strip().rstrip("/")
    if clean_slug.endswith(".html"):
        return redirect(f"/exempel/{clean_slug[:-5]}", code=301)
    if clean_slug in LEGACY_EXAMPLE_REDIRECTS:
        return redirect(LEGACY_EXAMPLE_REDIRECTS[clean_slug], code=301)

    registry = build_example_registry()
    item = registry.get(clean_slug)
    if not item:
        abort(404)

    canonical_slug = str(item.get("canonical_slug", "") or clean_slug).strip()
    if clean_slug != canonical_slug:
        return redirect(f"/exempel/{canonical_slug}", code=301)

    manufacturer = str(item.get("manufacturer", "") or "").strip()
    model = str(item.get("model", "") or "").strip()
    full_title = " ".join(part for part in [manufacturer, model] if part).strip() or canonical_slug
    page_title = f"{full_title} - Henricssons Båtkapell"
    page_description = str(item.get("description", "") or "").strip() or GENERIC_EXAMPLE_DESCRIPTION
    image_urls = [image_path_to_site_url(image) for image in item.get("images") or []]
    if not image_urls:
        image_urls = ["/logo.png"]

    gallery_html = f"""
    <div class="seo-gallery">
        <div class="seo-gallery-main">
            <img src="{html.escape(image_urls[0])}" alt="{html.escape(full_title)}" loading="eager"/>
        </div>
        <div class="seo-thumbs">
            {''.join(f'<img src="{html.escape(image)}" alt="{html.escape(full_title)}" loading="lazy"/>' for image in image_urls[:8])}
        </div>
    </div>
    """

    description_parts = []
    if str(item.get("description", "")).strip():
        for paragraph in str(item.get("description", "")).strip().splitlines():
            paragraph = paragraph.strip()
            if paragraph:
                description_parts.append(f"<p>{html.escape(paragraph)}</p>")
    else:
        description_parts.append(f"<p>{html.escape(GENERIC_EXAMPLE_DESCRIPTION)}</p>")

    meta_html = f"""
    <div class="seo-meta">
        <div class="seo-meta-block" style="border-top:0; padding-top:0;">
            <div class="seo-meta-label">Beskrivning</div>
            {''.join(description_parts)}
        </div>
        <div class="seo-meta-block">
            <div class="seo-meta-label">Variant</div>
            <p>{html.escape(str(item.get('variant', '') or '-'))}</p>
        </div>
        <div class="seo-meta-block">
            <div class="seo-meta-label">Leveransinfo</div>
            <p>{html.escape(str(item.get('delivery', '') or '-'))}</p>
        </div>
        <div class="seo-meta-block">
            <div class="seo-meta-label">Kategori</div>
            <p>{html.escape(str(item.get('category', '') or '-'))}</p>
        </div>
        <div class="seo-cta-row">
            <a class="seo-btn seo-btn-primary" href="/kapellforfragan">Kapellförfrågan</a>
            <a class="seo-btn" href="/kontakt">Mer information</a>
        </div>
    </div>
    """

    related: List[Dict[str, Any]] = []
    for related_item in list_canonical_examples():
        if str(related_item.get("canonical_slug", "")) == canonical_slug:
            continue
        if str(related_item.get("category", "")).strip() == str(item.get("category", "")).strip():
            related.append(related_item)
        if len(related) == 3:
            break

    related_cards = []
    for related_item in related:
        related_slug = str(related_item.get("canonical_slug", "")).strip()
        related_title = " ".join(
            part for part in [str(related_item.get("manufacturer", "")).strip(), str(related_item.get("model", "")).strip()] if part
        ).strip() or related_slug
        related_image = image_path_to_site_url((related_item.get("images") or ["/logo.png"])[0])
        related_cards.append(
            f"""
            <a class="seo-related-card" href="/exempel/{html.escape(related_slug)}">
                <img src="{html.escape(related_image)}" alt="{html.escape(related_title)}" loading="lazy"/>
                <div class="seo-related-copy">
                    <div class="seo-kicker">{html.escape(str(related_item.get('category', '') or 'Exempel'))}</div>
                    <strong>{html.escape(related_title)}</strong>
                </div>
            </a>
            """
        )

    content_html = f"""
    <main class="seo-page">
        <section class="seo-hero">
            <div class="seo-breadcrumbs">
                <a href="/">Start</a><span>/</span><a href="/bilder-och-exempel">Bilder & exempel</a><span>/</span><span>{html.escape(full_title)}</span>
            </div>
            <div class="seo-kicker">{html.escape(str(item.get('category', '') or 'Exempel'))}</div>
            <h1>{html.escape(full_title)}</h1>
            <p>Exempel på tidigare projekt från Henricssons Båtkapell. Här hittar du bilder, variantinformation och leveransinfo för modellen.</p>
        </section>
        <section class="seo-grid">
            <article class="seo-card">{gallery_html}</article>
            <aside class="seo-card">{meta_html}</aside>
        </section>
        <section class="seo-related">
            <h2>Fler exempel</h2>
            <div class="seo-related-grid">
                {''.join(related_cards) if related_cards else '<div class="seo-card"><p style="margin:0;">Fler exempel publiceras löpande.</p></div>'}
            </div>
        </section>
    </main>
    """
    return render_public_page(
        title=page_title,
        description=page_description,
        canonical_path=f"/exempel/{canonical_slug}",
        content_html=content_html,
        og_image=image_urls[0],
    )


@app.route("/healthz", methods=["GET"])
def healthz():
    return jsonify(status="ok"), 200


@app.route("/", methods=["GET"])
def root():
    if (BASE_DIR / "index.html").exists():
        return send_from_directory(str(BASE_DIR), "index.html")
    return jsonify(status="ok")


@app.route("/<path:filename>", methods=["GET"])
def serve_static(filename: str):
    if filename.startswith("api/"):
        abort(404)

    clean_name = filename.rstrip("/")
    if not clean_name:
        return redirect("/", code=301)

    # Keep legacy .html links working but canonicalize to extensionless URLs.
    if clean_name.endswith(".html"):
        page_slug = clean_name[:-5]
        target = (BASE_DIR / clean_name).resolve()
        if BASE_DIR in target.parents and target.exists() and target.is_file():
            if page_slug == "index":
                return redirect("/", code=301)
            return redirect(f"/{page_slug}", code=301)

    target = (BASE_DIR / clean_name).resolve()
    if BASE_DIR in target.parents and target.exists() and target.is_file():
        return send_from_directory(str(target.parent), target.name)

    html_target = (BASE_DIR / f"{clean_name}.html").resolve()
    if BASE_DIR in html_target.parents and html_target.exists() and html_target.is_file():
        return send_from_directory(str(html_target.parent), html_target.name)

    abort(404)


repaired_files = auto_repair_static_text_files()
if repaired_files:
    print(f"Auto-repaired mojibake in {len(repaired_files)} file(s):")
    for repaired_path in repaired_files:
        print(f" - {repaired_path.name}")

init_db()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 25565))
    debug_mode = os.getenv("FLASK_DEBUG", "0") == "1"
    print(f"Starting Flask server on port {port}")
    print(f"Admin API key configured: {'yes' if ADMIN_API_KEY else 'no (localhost only)'}")
    app.run(host="0.0.0.0", port=port, debug=debug_mode)

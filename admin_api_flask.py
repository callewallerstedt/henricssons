from __future__ import annotations

import base64
import hashlib
import html
import hmac
import ipaddress
import json
import os
import re
import time
import unicodedata
from datetime import datetime
from functools import wraps
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlencode, urlparse

import requests
from flask import Flask, Response, abort, jsonify, redirect, render_template_string, request, send_from_directory, has_request_context
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, JSON as SQLJSON, LargeBinary, String, Text, create_engine
from sqlalchemy.orm import Session, declarative_base, sessionmaker

app = Flask(__name__)

BASE_DIR = Path(__file__).resolve().parent


def load_local_env_file(path: Path) -> None:
    """Load a local .env file without overriding variables already set by the host."""
    if not path.exists() or not path.is_file():
        return

    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except Exception:
        return

    for raw_line in lines:
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        if "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip().lstrip("\ufeff")
        if not key or key in os.environ:
            continue

        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        os.environ[key] = value


load_local_env_file(BASE_DIR / ".env")

BOAT_DATA_FILE = BASE_DIR / "boat_data.json"
FORM_SUBMISSIONS_FILE = BASE_DIR / "form_submissions.json"
FORM_PROMPTS_FILE = BASE_DIR / "form_prompts.json"
PAGE_TEXTS_FILE = BASE_DIR / "page_texts.json"
AI_SETTINGS_FILE = BASE_DIR / "ai_settings.json"
LOGO_FILE = BASE_DIR / "logo.png"
IMAGES_ROOT = (BASE_DIR / "henricssons_bilder").resolve()
MODELS_META_FILE = IMAGES_ROOT / "models_meta.json"
EXAMPLES_META_FILE = BASE_DIR / "examples_meta.json"
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "https://henricssonsbatkapell.se").rstrip("/")
LEGACY_PUBLIC_HOSTS = {
    "www.henricssonsbatkapell.se",
    "henricssonsbatkapell.se",
    "henricssonsbatkapell.onrender.com",
    "henricssons-api.onrender.com",
    "henricssons.onrender.com",
    "henricssons-app.onrender.com",
}
PUBLIC_ATTACHMENT_BASE_URL = os.getenv(
    "PUBLIC_ATTACHMENT_BASE_URL",
    os.getenv("PUBLIC_API_BASE_URL", PUBLIC_BASE_URL),
).rstrip("/")
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
    "/dynsatser",
    "/tillfalliga-produkter",
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
ADMIN_CHAT_MODEL = os.getenv("ADMIN_CHAT_MODEL", "gpt-5.4").strip() or "gpt-5.4"
OPENAI_REASONING_EFFORT = os.getenv("OPENAI_REASONING_EFFORT", "minimal").strip().lower() or "minimal"
ADMIN_API_KEY = os.getenv("ADMIN_API_KEY", "").strip()
ADMIN_PANEL_PASSWORD = os.getenv("ADMIN_PANEL_PASSWORD", "").strip() or ADMIN_API_KEY
MAILGUN_DOMAIN = os.getenv("MAILGUN_DOMAIN", "").strip()
MAILGUN_API_KEY = os.getenv("MAILGUN_API_KEY", "").strip()
MAILGUN_FROM = os.getenv("MAILGUN_FROM", "").strip()
MAILGUN_TO_RAW = os.getenv("MAILGUN_TO", "").strip()
MAILGUN_API_BASE = os.getenv("MAILGUN_API_BASE", "https://api.mailgun.net").strip().rstrip("/")

DEFAULT_ALLOWED_ORIGINS = ",".join(
    [
        "https://henricssonsbatkapell.se",
        "https://www.henricssonsbatkapell.se",
        "https://henricssonsbatkapell.onrender.com",
        "http://localhost:25565",
        "http://127.0.0.1:25565",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]
)
REQUIRED_ALLOWED_ORIGINS = {
    "https://henricssonsbatkapell.se",
    "https://www.henricssonsbatkapell.se",
    "https://henricssonsbatkapell.onrender.com",
}
ALLOWED_ORIGINS = {
    origin.strip() for origin in os.getenv("ALLOWED_ORIGINS", DEFAULT_ALLOWED_ORIGINS).split(",") if origin.strip()
} | REQUIRED_ALLOWED_ORIGINS
PRIMARY_PUBLIC_HOST = "henricssonsbatkapell.se"
PUBLIC_HOST_ALIASES = {"henricssonsbatkapell.se", "www.henricssonsbatkapell.se"}

MAX_UPLOAD_BYTES = 8 * 1024 * 1024
ALLOWED_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}

# Attachment upload limits (per-file and per-submission aggregate)
MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
MAX_ATTACHMENTS_PER_SUBMISSION = 8
MAX_TOTAL_ATTACHMENT_BYTES = 40 * 1024 * 1024
ATTACHMENT_ALLOWED_MIME_PREFIXES = ("image/", "application/pdf")
ATTACHMENT_ALLOWED_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif", ".pdf"}
ATTACHMENT_MIME_BY_EXT = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".heic": "image/heic",
    ".heif": "image/heif",
    ".pdf": "application/pdf",
}
STATUS_FLOW = ["nya-inskick", "vantar-pa-svar", "i-produktion", "redo-for-leverans"]
MOJIBAKE_MARKERS = ("Ã", "Â", "â")
ADMIN_SESSION_COOKIE = "henricssons_admin"
ADMIN_SESSION_MAX_AGE = 60 * 60 * 12
FORM_RATE_LIMIT_WINDOW = 60
FORM_RATE_LIMIT_MAX = 8
FORM_RATE_LIMIT_LONG_WINDOW = 60 * 60
FORM_RATE_LIMIT_LONG_MAX = 30
FORM_MIN_SECONDS = 2
FORM_RATE_LIMITS: Dict[str, List[float]] = {}
MAX_ADMIN_CONTEXT_FIELD_CHARS = 900
MAX_ADMIN_CONTEXT_TEXT_CHARS = 1800
CHAT_WIDGET_DISABLED_JS = (
    "window.HenricssonsChatbotDisabled = true;\n"
    "document.documentElement.classList.add('henricssons-chatbot-disabled');\n"
)


def is_env_flag_enabled(name: str, default: str = "0") -> bool:
    raw = os.getenv(name)
    if raw is None:
        raw = os.getenv(name.upper())
    if raw is None:
        raw = os.getenv(name.lower())
    value = str(raw if raw is not None else default).strip().lower()
    return value in {"1", "true", "yes", "on"}


def is_public_chatbot_enabled() -> bool:
    return is_env_flag_enabled("enable_chatbot")

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


class SubmissionAttachment(Base):
    __tablename__ = "submission_attachments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    submission_id = Column(String, ForeignKey("form_submissions.id", ondelete="CASCADE"), index=True, nullable=False)
    filename = Column(String, nullable=False)
    mime = Column(String, nullable=False, default="application/octet-stream")
    size = Column(Integer, nullable=False, default=0)
    data = Column(LargeBinary, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    def to_meta(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "submission_id": self.submission_id,
            "filename": self.filename,
            "mime": self.mime,
            "size": int(self.size or 0),
            "is_image": str(self.mime or "").startswith("image/"),
            "url": f"/api/attachment/{self.id}",
        }


class TempProduct(Base):
    __tablename__ = "temp_products"

    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String, nullable=False, default="")
    description = Column(Text, nullable=False, default="")
    price = Column(String, nullable=False, default="")
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self, images: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title or "",
            "description": self.description or "",
            "price": self.price or "",
            "sort_order": int(self.sort_order or 0),
            "images": images or [],
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class TempProductImage(Base):
    __tablename__ = "temp_product_images"

    id = Column(Integer, primary_key=True, autoincrement=True)
    product_id = Column(Integer, ForeignKey("temp_products.id", ondelete="CASCADE"), index=True, nullable=False)
    filename = Column(String, nullable=False, default="")
    mime = Column(String, nullable=False, default="image/jpeg")
    data = Column(LargeBinary, nullable=False)
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    def to_meta(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "product_id": self.product_id,
            "filename": self.filename or "",
            "mime": self.mime or "image/jpeg",
            "sort_order": int(self.sort_order or 0),
            "url": f"/api/temp_product_image/{self.id}",
        }


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


def get_client_ip() -> str:
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return (request.remote_addr or "unknown").strip()


def sign_admin_session(timestamp: int) -> str:
    secret = ADMIN_PANEL_PASSWORD or ADMIN_API_KEY
    payload = str(timestamp)
    signature = hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{payload}.{signature}"


def verify_admin_session(token: str) -> bool:
    secret = ADMIN_PANEL_PASSWORD or ADMIN_API_KEY
    if not secret or not token or "." not in token:
        return False
    raw_ts, signature = token.rsplit(".", 1)
    try:
        issued_at = int(raw_ts)
    except ValueError:
        return False
    if int(time.time()) - issued_at > ADMIN_SESSION_MAX_AGE:
        return False
    expected = hmac.new(secret.encode("utf-8"), raw_ts.encode("utf-8"), hashlib.sha256).hexdigest()
    return hmac.compare_digest(signature, expected)


def sign_attachment_token(attachment_id: int) -> str:
    secret = ADMIN_PANEL_PASSWORD or ADMIN_API_KEY or "attachment-fallback"
    payload = f"att:{attachment_id}"
    return hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()[:24]


def verify_attachment_token(attachment_id: int, token: str) -> bool:
    if not token:
        return False
    expected = sign_attachment_token(attachment_id)
    return hmac.compare_digest(expected, token.strip())


def check_admin_access() -> bool:
    if verify_admin_session(request.cookies.get(ADMIN_SESSION_COOKIE, "")):
        return True
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


def render_admin_login(error: str = "") -> Response:
    error_html = f"<div class='error'>{html.escape(error)}</div>" if error else ""
    return Response(
        f"""<!DOCTYPE html>
<html lang="sv">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Admin - Henricssons</title>
  <style>
    body {{ margin:0; min-height:100vh; display:grid; place-items:center; background:#0c1a2b; font-family:Arial,sans-serif; color:#17212f; }}
    form {{ width:min(92vw,380px); background:#f5f0e6; padding:32px; border:1px solid #d9cfbe; box-shadow:0 24px 80px rgba(0,0,0,.28); }}
    img {{ display:block; height:54px; width:auto; margin:0 0 24px; }}
    h1 {{ margin:0 0 8px; font-size:24px; }}
    p {{ margin:0 0 22px; color:#667085; font-size:14px; line-height:1.5; }}
    label {{ display:block; margin:0 0 8px; font-size:12px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; }}
    input {{ width:100%; box-sizing:border-box; padding:13px 14px; border:1px solid #d9cfbe; background:#fff; font-size:16px; }}
    button {{ width:100%; margin-top:16px; padding:13px 14px; border:0; background:#b28a4c; color:#fff; font-weight:700; cursor:pointer; }}
    .error {{ margin:0 0 16px; padding:10px 12px; background:#fee2e2; color:#991b1b; font-size:14px; }}
  </style>
</head>
<body>
  <form method="post" action="/admin/login">
    <img src="/logo.png" alt="Henricssons Båtkapell">
    <h1>Adminpanel</h1>
    <p>Logga in för att hantera formulär, bilder och innehåll.</p>
    {error_html}
    <label for="password">Lösenord</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
    <button type="submit">Logga in</button>
  </form>
</body>
</html>""",
        mimetype="text/html; charset=utf-8",
    )


def validate_admin_password(password: str) -> bool:
    if not ADMIN_PANEL_PASSWORD:
        return is_local_request()
    return hmac.compare_digest(str(password or ""), ADMIN_PANEL_PASSWORD)


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
    if has_request_context():
        current_host_url = (request.host_url or "").rstrip("/")
        current_host = (request.host or "").split(":")[0].strip().lower()
        if current_host_url and (current_host in {"localhost", "127.0.0.1", "::1"} or is_local_request()):
            if not path or path == "/":
                return current_host_url
            clean_local = path if path.startswith("/") else f"/{path}"
            return f"{current_host_url}{clean_local}"
    if not path or path == "/":
        return PUBLIC_BASE_URL
    clean = path if path.startswith("/") else f"/{path}"
    return f"{PUBLIC_BASE_URL}{clean}"


def normalize_public_reference(value: str) -> str:
    clean = str(value or "").strip().replace("\\", "/")
    if not clean or clean.startswith("data:"):
        return clean
    parsed = urlparse(clean)
    hostname = (parsed.hostname or "").strip().lower()
    if parsed.scheme in {"http", "https"} and hostname in LEGACY_PUBLIC_HOSTS:
        path = parsed.path or "/"
        if parsed.query:
            path = f"{path}?{parsed.query}"
        if parsed.fragment:
            path = f"{path}#{parsed.fragment}"
        return absolute_public_url(path)
    return clean


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
        "images": [normalize_public_reference(str(image or "").strip()) for image in images if str(image or "").strip()],
        "source": normalize_public_reference(str(raw.get("source", "") or "").strip()),
        "fallback_slug": fallback_slug.strip(),
    }


def normalize_example_payload(data: Any) -> Dict[str, Dict[str, Any]]:
    if not isinstance(data, dict):
        return {}
    normalized: Dict[str, Dict[str, Any]] = {}
    for key, raw in data.items():
        normalized[str(key)] = normalize_example_record(raw, fallback_slug=str(key))
    return normalized


def extract_example_slug(source: str, fallback_slug: str = "") -> str:
    source = str(source or "").strip()
    if source:
        parsed = urlparse(source)
        path = parsed.path.strip("/")
        if path.startswith("exempel/"):
            return path.split("/", 1)[1].strip()
    return fallback_slug.strip()


def build_contact_example_href(manufacturer: str, model: str, canonical_slug: str) -> str:
    params: Dict[str, str] = {}
    manufacturer = str(manufacturer or "").strip()
    model = str(model or "").strip()
    canonical_slug = str(canonical_slug or "").strip()
    if manufacturer:
        params["manufacturer"] = manufacturer
    if model:
        params["model"] = model
    if canonical_slug:
        params["example"] = f"/exempel/{canonical_slug}"
    query = urlencode(params)
    return f"/kontakt?{query}" if query else "/kontakt"


def build_kapell_example_href(manufacturer: str, model: str, canonical_slug: str) -> str:
    params: Dict[str, str] = {}
    manufacturer = str(manufacturer or "").strip()
    model = str(model or "").strip()
    canonical_slug = str(canonical_slug or "").strip()
    if manufacturer:
        params["manufacturer"] = manufacturer
    if model:
        params["model"] = model
    if canonical_slug:
        params["example"] = f"/exempel/{canonical_slug}"
    query = urlencode(params)
    return f"/kapellforfragan?{query}" if query else "/kapellforfragan"


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


def build_contact_example_href(manufacturer: str, model: str, canonical_slug: str) -> str:
    params: Dict[str, str] = {}
    manufacturer = str(manufacturer or "").strip()
    model = str(model or "").strip()
    canonical_slug = str(canonical_slug or "").strip()
    if manufacturer:
        params["manufacturer"] = manufacturer
    if model:
        params["model"] = model
    if canonical_slug:
        params["example"] = f"/exempel/{canonical_slug}"
    query = urlencode(params)
    return f"/kontakt?{query}" if query else "/kontakt"


def build_kapell_example_href(manufacturer: str, model: str, canonical_slug: str) -> str:
    params: Dict[str, str] = {}
    manufacturer = str(manufacturer or "").strip()
    model = str(model or "").strip()
    canonical_slug = str(canonical_slug or "").strip()
    if manufacturer:
        params["manufacturer"] = manufacturer
    if model:
        params["model"] = model
    if canonical_slug:
        params["example"] = f"/exempel/{canonical_slug}"
    query = urlencode(params)
    return f"/kapellforfragan?{query}" if query else "/kapellforfragan"


def render_public_page(title: str, description: str, canonical_path: str, content_html: str, og_image: str = "/logo.png") -> str:
    canonical_url = absolute_public_url(canonical_path)
    og_image_url = og_image if og_image.startswith("http://") or og_image.startswith("https://") else absolute_public_url(og_image)
    examples_active = canonical_path == "/bilder-och-exempel" or canonical_path.startswith("/exempel/") or canonical_path.startswith("/search")
    temp_products_active = canonical_path == "/tillfalliga-produkter" or canonical_path.startswith("/tillfalliga-produkter/")
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
    <link rel="stylesheet" href="/premium.css?v=20260420b">
    <style>
        .seo-page {
            max-width: 1200px;
            margin: 0 auto;
            padding: 4.5rem 1.5rem 4rem;
        }
        .seo-hero {
            display: grid;
            gap: 1rem;
            margin-bottom: 2.5rem;
        }
        .seo-breadcrumbs {
            display: flex;
            flex-wrap: wrap;
            gap: 0.5rem;
            color: var(--muted);
            font-size: 0.88rem;
            letter-spacing: 0.04em;
        }
        .seo-breadcrumbs a {
            color: var(--muted);
            text-decoration: none;
        }
        .seo-breadcrumbs a:hover {
            color: var(--ink);
            text-decoration: underline;
        }
        .seo-kicker {
            font-family: 'Montserrat', sans-serif;
            font-size: 0.78rem;
            text-transform: uppercase;
            letter-spacing: 0.22em;
            color: var(--brass);
            font-weight: 600;
        }
        .seo-hero h1 {
            font-size: clamp(2rem, 4.2vw, 3.2rem);
            line-height: 1.12;
            max-width: 820px;
        }
        .seo-hero p {
            max-width: 760px;
            color: var(--muted);
            font-size: 1rem;
            line-height: 1.75;
        }
        .seo-grid {
            display: grid;
            gap: 2rem;
            grid-template-columns: minmax(0, 1.35fr) minmax(300px, 0.85fr);
            align-items: start;
        }
        .seo-card {
            background: var(--white);
            border: 1px solid rgba(12, 26, 43, 0.09);
            box-shadow: 0 18px 42px rgba(12, 26, 43, 0.08);
            padding: 1.5rem;
        }
        .seo-card p,
        .seo-card li {
            color: var(--muted);
        }
        .seo-gallery {
            display: grid;
            gap: 0.9rem;
        }
        .seo-gallery-stage {
            position: relative;
            min-height: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0;
            background: var(--cream-2);
            overflow: hidden;
        }
        .seo-gallery-main {
            position: relative;
            width: 100%;
            height: auto;
            min-height: 0;
            cursor: zoom-in;
            overflow: hidden;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .seo-gallery-main img {
            width: 100%;
            max-width: 100%;
            height: auto;
            min-height: 0;
            max-height: 72vh;
            object-fit: contain;
            object-position: center;
            display: block;
            background: var(--cream-2);
        }
        .seo-gallery-main img[src$="logo.png"] {
            width: auto;
            height: auto;
            max-width: min(86%, 420px);
            max-height: 86%;
            object-fit: contain;
            margin: auto;
        }
        .seo-gallery-expand {
            position: absolute;
            right: 1rem;
            bottom: 1rem;
            border: 0;
            background: rgba(12, 26, 43, 0.82);
            color: var(--white);
            padding: 0.75rem 1rem;
            font-family: 'Montserrat', sans-serif;
            font-size: 0.72rem;
            font-weight: 600;
            letter-spacing: 0.14em;
            text-transform: uppercase;
            cursor: pointer;
            transition: background 0.2s ease;
        }
        .seo-gallery-expand:hover {
            background: rgba(178, 138, 76, 0.92);
        }
        .seo-gallery-nav {
            position: absolute;
            top: 50%;
            transform: translateY(-50%);
            width: 48px;
            height: 48px;
            border: 1px solid rgba(12, 26, 43, 0.16);
            background: rgba(255, 255, 255, 0.92);
            color: var(--ink);
            font-size: 1.8rem;
            line-height: 1;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            transition: background 0.2s, border-color 0.2s, color 0.2s;
        }
        .seo-gallery-nav:hover {
            background: var(--white);
            border-color: var(--brass);
            color: var(--brass);
        }
        .seo-gallery-nav:disabled {
            opacity: 0.3;
            cursor: default;
        }
        .seo-gallery-prev { left: 1rem; }
        .seo-gallery-next { right: 1rem; }
        .seo-thumbs {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(64px, 84px));
            gap: 0.55rem;
            justify-content: start;
        }
        .seo-thumb {
            border: 1px solid rgba(12, 26, 43, 0.12);
            background: var(--cream);
            padding: 0.25rem;
            cursor: pointer;
            transition: border-color 0.2s, box-shadow 0.2s;
        }
        .seo-thumb:hover { border-color: rgba(178, 138, 76, 0.6); }
        .seo-thumb.is-active {
            border-color: var(--brass);
            box-shadow: inset 0 0 0 1px var(--brass);
        }
        .seo-thumb img {
            width: 100%;
            aspect-ratio: 1;
            object-fit: contain;
            display: block;
            background: var(--cream-2);
        }
        .seo-meta {
            display: grid;
            gap: 0.9rem;
        }
        .seo-meta-block {
            border-top: 1px solid rgba(12, 26, 43, 0.08);
            padding-top: 0.9rem;
        }
        .seo-meta-label {
            font-size: 0.78rem;
            text-transform: uppercase;
            letter-spacing: 0.14em;
            color: var(--brass);
            font-weight: 600;
            margin-bottom: 0.35rem;
        }
        .seo-interest-text {
            margin: 0.2rem 0 0;
            color: #627084;
            font-size: 0.98rem;
            line-height: 1.6;
        }
        .seo-cta-row {
            display: flex;
            flex-wrap: wrap;
            gap: 0.8rem;
            margin-top: 1.2rem;
        }
        .seo-btn,
        button.seo-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-height: 48px;
            padding: 0.9rem 1.5rem;
            border: 1px solid var(--ink);
            background: transparent;
            color: var(--ink);
            text-decoration: none;
            font-family: 'Montserrat', sans-serif;
            font-size: 0.8rem;
            font-weight: 600;
            letter-spacing: 0.14em;
            text-transform: uppercase;
            cursor: pointer;
            transition: background 0.2s, color 0.2s, border-color 0.2s;
        }
        .seo-btn:hover,
        button.seo-btn:hover {
            background: var(--ink);
            color: var(--cream);
        }
        .seo-btn.seo-btn-primary,
        button.seo-btn.seo-btn-primary {
            background: var(--brass);
            color: var(--white);
            border-color: var(--brass);
        }
        .seo-btn.seo-btn-primary:hover,
        button.seo-btn.seo-btn-primary:hover {
            background: var(--ink);
            color: var(--cream);
            border-color: var(--ink);
        }
        .seo-related {
            margin-top: 2.75rem;
        }
        .seo-related h2 {
            font-size: clamp(1.7rem, 3vw, 2.3rem);
            margin-bottom: 1.25rem;
        }
        .seo-related-grid {
            display: grid;
            gap: 1rem;
            grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 320px));
            justify-content: start;
        }
        .seo-related-card {
            background: var(--white);
            border: 1px solid rgba(12, 26, 43, 0.08);
            color: var(--ink);
            overflow: hidden;
            text-decoration: none;
            transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .seo-related-card:hover {
            transform: translateY(-3px);
            box-shadow: 0 18px 38px rgba(12, 26, 43, 0.12);
        }
        .seo-related-card img {
            width: 100%;
            aspect-ratio: 4 / 3;
            object-fit: cover;
            display: block;
            background: var(--cream-2);
        }
        .seo-related-copy {
            padding: 1rem;
            display: grid;
            gap: 0.45rem;
        }
        .seo-related-copy strong {
            color: var(--ink);
            font-size: 1rem;
            line-height: 1.5;
        }
        .seo-search-form {
            display: flex;
            gap: 0.75rem;
            flex-wrap: wrap;
            margin: 1.2rem 0 1.8rem;
        }
        .seo-search-form input {
            flex: 1 1 260px;
            min-height: 48px;
            padding: 0 1rem;
            border: 1px solid rgba(12, 26, 43, 0.16);
            font: inherit;
            background: var(--white);
            color: var(--ink);
        }
        .seo-search-form input:focus {
            outline: none;
            border-color: var(--brass);
        }
        .seo-search-list {
            display: grid;
            gap: 0.9rem;
        }
        .seo-search-item {
            background: var(--white);
            border: 1px solid rgba(12, 26, 43, 0.08);
            padding: 1.1rem 1.2rem;
            display: grid;
            gap: 0.35rem;
        }
        .seo-search-item h2 a {
            color: var(--ink);
            text-decoration: none;
        }
        .seo-search-item h2 a:hover { color: var(--brass); }
        .seo-lightbox {
            position: fixed;
            inset: 0;
            display: none;
            align-items: center;
            justify-content: center;
            background: rgba(5, 10, 18, 0.96);
            z-index: 2200;
            padding: 4rem 1.5rem 2rem;
        }
        .seo-lightbox.is-open {
            display: flex;
        }
        .seo-lightbox-stage {
            position: relative;
            max-width: min(92vw, 1500px);
            max-height: 82vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .seo-lightbox-stage img {
            max-width: 100%;
            max-height: 82vh;
            width: auto;
            height: auto;
            object-fit: contain;
            display: block;
        }
        .seo-lightbox-close,
        .seo-lightbox-nav,
        .seo-lightbox-fullscreen {
            border: 0;
            cursor: pointer;
        }
        .seo-lightbox-close {
            position: absolute;
            top: 1rem;
            right: 1rem;
            width: 52px;
            height: 52px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            background: rgba(255, 255, 255, 0.12);
            color: var(--white);
            font-size: 2rem;
            line-height: 1;
            z-index: 2;
        }
        .seo-lightbox-close:hover {
            background: rgba(255, 255, 255, 0.2);
        }
        .seo-lightbox-nav {
            position: absolute;
            top: 50%;
            transform: translateY(-50%);
            width: 56px;
            height: 56px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            background: rgba(255, 255, 255, 0.12);
            color: var(--white);
            font-size: 2rem;
            z-index: 2;
        }
        .seo-lightbox-nav:hover {
            background: rgba(255, 255, 255, 0.2);
        }
        .seo-lightbox-prev { left: 1rem; }
        .seo-lightbox-next { right: 1rem; }
        .seo-lightbox-actions {
            position: absolute;
            left: 50%;
            bottom: 1rem;
            transform: translateX(-50%);
            display: flex;
            gap: 0.75rem;
            z-index: 2;
        }
        .seo-lightbox-fullscreen {
            background: rgba(255, 255, 255, 0.14);
            color: var(--white);
            padding: 0.85rem 1.1rem;
            font-family: 'Montserrat', sans-serif;
            font-size: 0.72rem;
            font-weight: 600;
            letter-spacing: 0.14em;
            text-transform: uppercase;
        }
        .seo-lightbox-fullscreen:hover {
            background: rgba(178, 138, 76, 0.92);
        }
        @media (max-width: 900px) {
            .seo-grid { grid-template-columns: 1fr; }
            .seo-page { padding-top: 3rem; }
            .seo-thumbs { grid-template-columns: repeat(auto-fit, minmax(60px, 72px)); }
        }
        @media (max-width: 640px) {
            .seo-page { padding: 2.5rem 1rem 3rem; }
            .seo-gallery-main img { max-height: 64vh; }
            .seo-hero h1 { font-size: 1.8rem; }
            .seo-cta-row,
            .seo-search-form { flex-direction: column; }
            .seo-btn,
            button.seo-btn { width: 100%; }
            .seo-gallery-expand { left: 1rem; right: auto; bottom: 0.8rem; }
            .seo-lightbox { padding: 4.5rem 1rem 1.25rem; }
            .seo-lightbox-close {
                top: 0.75rem;
                right: 0.75rem;
                width: 46px;
                height: 46px;
                font-size: 1.7rem;
            }
            .seo-lightbox-nav {
                width: 46px;
                height: 46px;
                font-size: 1.7rem;
            }
            .seo-lightbox-prev { left: 0.5rem; }
            .seo-lightbox-next { right: 0.5rem; }
            .seo-lightbox-actions {
                left: 1rem;
                right: 1rem;
                transform: none;
                justify-content: center;
            }
        }
    </style>
</head>
<body class="hb-premium">
    <div class="hb-top">
        <div class="wrap">
            <div class="hb-top-left"><span>Familjeföretag sedan 1967 &middot; Kungsbacka</span></div>
            <div class="hb-top-right">
                <a href="tel:+46314718200">+46 (0)31 47 18 20</a>
                <a href="mailto:info@henricssonsbatkapell.se">info@henricssonsbatkapell.se</a>
            </div>
        </div>
    </div>

    <header class="hb-header">
        <div class="wrap hb-nav">
            <a href="/" class="hb-logo"><img src="/logo.png" alt="Henricssons Båtkapell"/></a>
            <button class="hb-burger" aria-label="Meny" onclick="document.getElementById('hbNav').classList.toggle('is-open')">
                <span></span><span></span><span></span>
            </button>
            <nav class="hb-nav-links" id="hbNav">
                <a href="/om-oss">Om oss</a>
                <a href="/bilder-och-exempel"{% if examples_active %} class="active"{% endif %}>Bilder &amp; exempel</a>
                <details class="hb-nav-dropdown">
                    <summary class="hb-nav-summary{% if temp_products_active %} active{% endif %}">Övriga produkter</summary>
                    <div class="hb-nav-submenu">
                        <a href="/tillbehor">Fenderstrumpor</a>
                        <a href="/dynsatser">Dynsatser</a>
                        <a href="/tillfalliga-produkter"{% if temp_products_active %} class="active"{% endif %}>Tillfälliga produkter</a>
                    </div>
                </details>
                <a href="/kontakt">Kontakt</a>
                <a href="/kapellforfragan" class="hb-nav-cta">Kapellförfrågan</a>
            </nav>
        </div>
    </header>

    {{ content_html | safe }}

    <section class="hb-section hb-finalcta">
        <div class="hb-finalcta-bg"><img src="/bakgrundhav.webp" alt=""/></div>
        <div class="wrap">
            <span class="eyebrow" style="color: var(--brass);">Behöver du nytt kapell?</span>
            <span class="rule"></span>
            <h2>Ta nästa steg med en <em>förfrågan</em></h2>
            <p>Utgå från modellen du tittar på eller skicka en fri förfrågan. Vi återkommer med vägledning och offert.</p>
            <div class="hb-ctas">
                <a href="/kapellforfragan" class="hb-btn hb-btn-primary"><span>Skicka kapellförfrågan</span></a>
                <a href="/kontakt" class="hb-btn hb-btn-ghost">Kontakta oss</a>
            </div>
            <div class="phone">eller ring direkt &middot; <a href="tel:+46314718200">+46 (0)31 47 18 20</a></div>
        </div>
    </section>

    <footer class="hb-footer">
        <div class="wrap">
            <div class="grid">
                <div class="brand">
                    <img src="/logo.png" alt="Henricssons Båtkapell"/>
                    <p>Familjeföretag i Kungsbacka sedan 1967. Vi tillverkar kapell till motorbåtar och segelbåtar och importerar originalkapell från Norge, Finland och Danmark.</p>
                    <div class="credit">
                        <img src="/KV.svg" alt="Högsta kreditvärdighet"/>
                        <div class="t">
                            <strong>HÖGSTA KREDITVÄRDIGHET</strong><br/>
                            Henricssons Båtkapell AB<br/>
                            556799-2192
                        </div>
                    </div>
                </div>
                <div>
                    <h5>Navigera</h5>
                    <ul>
                        <li><a href="/om-oss">Om oss</a></li>
                        <li><a href="/kapellforfragan">Kapellförfrågan</a></li>
                        <li><a href="/bilder-och-exempel">Bilder &amp; exempel</a></li>
                        <li><a href="/tillbehor">Fenderstrumpor</a></li>
                        <li><a href="/dynsatser">Dynsatser</a></li>
                        <li><a href="/tillfalliga-produkter">Tillfälliga produkter</a></li>
                        <li><a href="/kontakt">Kontakt</a></li>
                    </ul>
                </div>
                <div>
                    <h5>Kontakt</h5>
                    <ul>
                        <li><a href="tel:+46314718200">+46 (0)31 47 18 20</a></li>
                        <li><a href="mailto:info@henricssonsbatkapell.se">info@henricssonsbatkapell.se</a></li>
                        <li>Energigatan 17E</li>
                        <li>434 37 Kungsbacka</li>
                    </ul>
                </div>
                <div>
                    <h5>Partners</h5>
                    <ul>
                        <li>Jens Sagen</li>
                        <li>Helly Hansen</li>
                        <li>VA Varuste</li>
                        <li>Schultz Kalecher</li>
                        <li>MP Venekuomu</li>
                    </ul>
                </div>
            </div>
            <div class="hb-footer-bottom">
                <div>&copy; Henricssons Båtkapell AB &middot; Org.nr 556799-2192</div>
                <div>Kungsbacka, Sverige</div>
            </div>
        </div>
    </footer>
    <script src="/chat_widget.js?v=20260420a"></script>
    <script>
        (function () {
            const nav = document.getElementById('hbNav');
            if (!nav) return;
            nav.querySelectorAll('a').forEach((link) => {
                link.addEventListener('click', () => {
                    nav.classList.remove('is-open');
                });
            });
        })();
    </script>
</body>
</html>""",
        title=title,
        description=description,
        canonical_url=canonical_url,
        og_image_url=og_image_url,
        content_html=content_html,
        examples_active=examples_active,
        temp_products_active=temp_products_active,
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


def normalize_recipient_list(value: Any) -> List[str]:
    if isinstance(value, list):
        candidates = value
    else:
        candidates = re.split(r"[,\n;]+", str(value or ""))
    recipients: List[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        email = str(candidate or "").strip().lower()
        if not email or not is_valid_email_address(email) or email in seen:
            continue
        recipients.append(email)
        seen.add(email)
    return recipients


def load_mailgun_settings() -> Dict[str, Any]:
    data = get_site_content("mailgun_settings")
    recipients: List[str] = []
    if isinstance(data, dict):
        recipients = normalize_recipient_list(data.get("to") or data.get("recipients"))
    if not recipients:
        recipients = normalize_recipient_list(MAILGUN_TO_RAW)
    return {
        "to": ", ".join(recipients),
        "recipients": recipients,
    }


def save_mailgun_settings(data: Dict[str, Any]) -> Dict[str, Any]:
    recipients = normalize_recipient_list(data.get("to") or data.get("recipients"))
    if not recipients:
        raise ValueError("Minst en giltig e-postadress krävs.")
    payload = {
        "to": ", ".join(recipients),
        "recipients": recipients,
    }
    set_site_content("mailgun_settings", payload)
    return payload


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
    normalized_reasoning_effort = {
        "minimal": "low",
        "min": "low",
        "off": "none",
    }.get(OPENAI_REASONING_EFFORT, OPENAI_REASONING_EFFORT)
    payload: Dict[str, Any] = {
        "model": target_model,
        "messages": messages,
        "temperature": temperature,
    }
    is_gpt5 = str(target_model).lower().startswith("gpt-5")
    if is_gpt5:
        payload["max_completion_tokens"] = max(int(max_tokens), 120)
        payload["reasoning_effort"] = normalized_reasoning_effort
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
    if "dyn" in lowered or "dyna" in lowered:
        return "Dynsatsforfragan"
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
    if key == "Dynsatsforfragan":
        return "Dynsatsförfrågan"
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


def field_lookup_key(key: str) -> str:
    text = str(key or "").strip().lower()
    text = re.sub(r"^\d+\.\s*", "", text)
    text = text.replace("å", "a").replace("ä", "a").replace("ö", "o")
    text = text.replace("-", "_").replace(" ", "_")
    text = re.sub(r"[^a-z0-9_]", "", text)
    return DRAFT_KEY_ALIASES.get(text, text)


def get_field_value(fields: Dict[str, Any], *names: str) -> str:
    if not isinstance(fields, dict):
        return ""
    wanted = {field_lookup_key(name) for name in names if name}
    for raw_key, raw_value in fields.items():
        if field_lookup_key(str(raw_key)) in wanted:
            value = str(raw_value or "").strip()
            if value:
                return value
    return ""


def is_form_rate_limited(ip: str) -> bool:
    now = time.time()
    recent = [ts for ts in FORM_RATE_LIMITS.get(ip, []) if now - ts <= FORM_RATE_LIMIT_LONG_WINDOW]
    FORM_RATE_LIMITS[ip] = recent
    short_count = sum(1 for ts in recent if now - ts <= FORM_RATE_LIMIT_WINDOW)
    if short_count >= FORM_RATE_LIMIT_MAX or len(recent) >= FORM_RATE_LIMIT_LONG_MAX:
        return True
    recent.append(now)
    FORM_RATE_LIMITS[ip] = recent
    return False


EMAIL_ADDRESS_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def is_valid_email_address(value: Any) -> bool:
    email = str(value or "").strip()
    if not email or len(email) > 254:
        return False
    if not EMAIL_ADDRESS_RE.match(email):
        return False
    local_part, _, domain = email.rpartition("@")
    if not local_part or not domain:
        return False
    if domain.startswith(".") or domain.endswith(".") or ".." in email:
        return False
    return True


def validate_public_form_submission(fields: Dict[str, Any], submitted_via: str) -> Optional[Tuple[Dict[str, Any], int]]:
    if submitted_via != "web_form":
        return None

    ip = get_client_ip()
    if is_form_rate_limited(ip):
        return {"error": "För många formulärförsök. Vänta en stund och försök igen."}, 429

    honeypot = str(fields.get("website", "") or fields.get("url", "") or "").strip()
    if honeypot:
        return {"error": "Formuläret kunde inte skickas."}, 400

    started_raw = str(fields.get("__form_started_at", "") or "").strip()
    try:
        started_at = float(started_raw) / 1000
    except ValueError:
        started_at = 0
    if not started_at or time.time() - started_at < FORM_MIN_SECONDS:
        return {"error": "Formuläret skickades för snabbt. Försök igen."}, 400

    customer_email = get_field_value(fields, "email", "e-post", "e-postadress")
    if customer_email and not is_valid_email_address(customer_email):
        return {"error": "Ange en giltig e-postadress."}, 400

    return None


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
) -> Tuple[str, str]:
    category = "Allman fraga"
    title = f"{form_type}: {fields.get('1. Namn', fields.get('Namn', 'Kund'))}"
    if len(title) > 70:
        title = title[:67] + "..."

    category_prompt = (
        "Categorize this customer message into one of: "
        "Kapellforfragan, Allman fraga, Support/Service, Besoksforfragan.\n\n"
        f"{form_summary}\n\nOnly return the category name."
    )
    title_prompt = (
        "Create a short subject line (max 60 chars) for this customer message.\n\n"
        f"{form_summary}\n\nOnly return the title."
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

    return category, title


def generate_submission_ai_response(form_type: str, fields: Dict[str, Any], form_summary: str = "") -> str:
    safe_fields = sanitize_fields(fields, submitted_via=str(fields.get("__submitted_via", "web_form")) if isinstance(fields, dict) else "web_form")
    summary = form_summary or build_form_summary(form_type, safe_fields)
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
    response_prompt = (
        "Skriv ett kort svenskt mejlsvar enligt systeminstruktionerna.\n"
        "Målet är att ta ärendet till nästa tydliga steg och öka chansen till avslut.\n\n"
        f"{summary}"
    )
    generated = get_openai_response(
        response_prompt,
        f"{system_prompt}\n\n{email_rules}",
        0.6,
        550,
        model=CHAT_MODEL,
    )
    return finalize_email_reply(generated)


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
    return load_mailgun_settings()["recipients"]


FIELD_LABELS_SV: Dict[str, str] = {
    "name": "Namn",
    "email": "E-post",
    "phone": "Telefonnummer",
    "address": "Adress",
    "postal_code": "Postnummer",
    "city": "Ort",
    "boat_brand": "Båtmärke",
    "boat_model": "Båtmodell",
    "manufacturer": "Tillverkare",
    "model": "Modell",
    "boat_year": "Årsmodell",
    "home_port": "Hemmahamn",
    "old_canopy": "Tillverkare av befintligt kapell",
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
    "Dynsatsforfragan": "Dynsatsförfrågan",
    "Kontakt": "Kontaktärende",
}

NOTIFICATION_FORM_LABELS_SV: Dict[str, str] = {
    "Kapellforfragan": "Kapellförfrågan",
    "Fenderforfragan": "Fenderförfrågan",
    "Dynsatsforfragan": "Dynsatsförfrågan",
    "Kontakt": "Kontakt",
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


def truncate_notification_preview(text: str, limit: int = 120) -> str:
    clean = re.sub(r"\s+", " ", str(text or "")).strip()
    if len(clean) <= limit:
        return clean
    return clean[: max(0, limit - 3)].rstrip() + "..."


def build_submission_notification_preview(fields: Dict[str, Any]) -> Tuple[str, str]:
    if not isinstance(fields, dict):
        return "", ""

    manufacturer = get_field_value(fields, "manufacturer", "boat_brand", "tillverkare", "båtmärke")
    model = get_field_value(fields, "model", "boat_model", "modell", "båtmodell")
    subject = get_field_value(fields, "subject", "ämne")
    size = get_field_value(fields, "size", "storlek")
    quantity = get_field_value(fields, "quantity", "antal")
    message = get_field_value(fields, "message", "meddelande", "övrig information", "ovrig information")

    primary_line = " ".join(part for part in [manufacturer, model] if part).strip()
    if not primary_line:
        primary_line = subject.strip()
    if not primary_line and (size or quantity):
        primary_line = " ".join(part for part in [quantity, size] if part).strip()

    return truncate_notification_preview(primary_line, limit=80), truncate_notification_preview(message, limit=140)


def build_notification_html(
    form_type: str,
    fields: Dict[str, Any],
    submission_id: str,
    timestamp_iso: str,
    attachments: Optional[List[Dict[str, Any]]] = None,
    proposed_response: str = "",
    preview_title: str = "",
    preview_message: str = "",
) -> str:
    form_label = html.escape(FORM_TYPE_LABELS_SV.get(form_type, form_type))

    ordered_keys = [k for k in FIELD_ORDER if k in fields]
    extra_keys = [k for k in fields if k not in FIELD_ORDER and k != "__submitted_via"]
    all_keys = ordered_keys + extra_keys

    rows_html = ""
    for key in all_keys:
        raw = fields.get(key, "")
        val = _humanize_value(raw)
        if not val:
            continue
        rows_html += (
            "<tr>"
            f"<td style='padding:10px 12px;border:1px solid #d9dee5;"
            f"font-weight:600;color:#222831;font-size:13px;width:34%;vertical-align:top;'>"
            f"{html.escape(_label(key))}</td>"
            f"<td style='padding:10px 12px;border:1px solid #d9dee5;"
            f"color:#222831;font-size:14px;word-break:break-word;'>"
            f"{html.escape(val)}</td>"
            "</tr>"
        )

    if not rows_html:
        rows_html = (
            "<tr><td colspan='2' style='padding:12px;border:1px solid #d9dee5;"
            "color:#6b7280;font-style:italic;'>Inga fält</td></tr>"
        )

    try:
        from datetime import datetime, timezone
        dt = datetime.fromisoformat(timestamp_iso.replace("Z", "+00:00"))
        local_str = dt.strftime("%d %b %Y, %H:%M") + " UTC"
    except Exception:
        local_str = html.escape(timestamp_iso)

    attachments_block = ""
    if attachments:
        attachment_rows: List[str] = []
        for att in attachments:
            filename = html.escape(str(att.get("filename", "bilaga")))
            mime = str(att.get("mime", ""))
            size_kb = max(1, int((att.get("size") or 0) / 1024))
            public_url = html.escape(str(att.get("public_url", "")))
            kind = "Bild" if mime.startswith("image/") else "Fil"
            attachment_rows.append(
                "<tr>"
                f"<td style='padding:10px 12px;border:1px solid #d9dee5;"
                f"font-weight:600;color:#222831;font-size:13px;width:34%;vertical-align:top;'>{kind}</td>"
                f"<td style='padding:10px 12px;border:1px solid #d9dee5;color:#222831;font-size:14px;'>"
                f"<a href='{public_url}' style='color:#222831;text-decoration:underline;'>{filename}</a>"
                f" <span style='color:#6b7280;'>({size_kb} KB)</span></td>"
                "</tr>"
            )
        attachments_block = (
            "<div style='margin-top:20px;'>"
            "<div style='font-size:12px;font-weight:700;color:#222831;margin-bottom:8px;'>Bilagor</div>"
            "<table width='100%' cellpadding='0' cellspacing='0' style='border-collapse:collapse;'>"
            + "".join(attachment_rows)
            + "</table></div>"
        )

    ai_reply_block = ""
    if str(proposed_response or "").strip():
        ai_reply_html = html.escape(str(proposed_response).strip()).replace("\n", "<br>")
        ai_reply_block = (
            "<div style='margin-top:20px;'>"
            "<div style='font-size:12px;font-weight:700;color:#222831;margin-bottom:8px;'>AI-utkast till svar</div>"
            "<div style='padding:12px;border:1px solid #d9dee5;background:#fafafa;"
            "font-size:14px;line-height:1.6;color:#222831;'>"
            f"{ai_reply_html}</div>"
            "</div>"
        )

    preview_block = ""
    if preview_title or preview_message:
        preview_parts: List[str] = []
        if preview_title:
            preview_parts.append(
                f"<div style='font-size:20px;font-weight:700;color:#222831;margin:0 0 6px;'>{html.escape(preview_title)}</div>"
            )
        if preview_message:
            preview_parts.append(
                f"<div style='font-size:14px;line-height:1.6;color:#4b5563;'>{html.escape(preview_message)}</div>"
            )
        preview_block = (
            "<div style='margin:0 0 18px;padding:16px 18px;background:#f7f9fc;border:1px solid #d9dee5;'>"
            + "".join(preview_parts)
            + "</div>"
        )

    meta_block = (
        "<div style='margin-top:18px;padding:12px 14px;background:#fafafa;border:1px solid #e5e7eb;'>"
        f"<div style='font-size:12px;color:#6b7280;line-height:1.6;'>Tid (UTC): {local_str}</div>"
        f"<div style='font-size:12px;color:#6b7280;line-height:1.6;'>Referens-ID: {html.escape(submission_id)}</div>"
        "</div>"
    )

    return f"""<!DOCTYPE html>
<html lang="sv">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px;background:#f5f5f5;font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;color:#222831;">
<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
<tr>
<td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;border-collapse:collapse;background:#ffffff;border:1px solid #d9dee5;">
  <tr>
    <td style="padding:20px 24px 24px;">
      {preview_block}
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        {rows_html}
      </table>
      {attachments_block}
      {ai_reply_block}
      {meta_block}
    </td>
  </tr>
  <tr>
    <td style="padding:14px 24px;border-top:1px solid #d9dee5;font-size:12px;color:#6b7280;">
      Henricssonsbatkapell.se - automatiskt internt meddelande
    </td>
  </tr>
</table>
</td>
</tr>
</table>
</body>
</html>"""


_FORM_TYPE_COPY: Dict[str, Dict[str, str]] = {
    "Kontakt": {
        "received": "Vi har tagit emot ditt meddelande och &#229;terkommer s&#229; snart vi kan.",
        "followup": "Om du vill till&#228;gga n&#229;got eller har fler fr&#229;gor &#228;r du v&#228;lkommen att svara p&#229; detta e-postmeddelande eller kontakta oss direkt p&#229; uppgifterna nedan.",
    },
}
_FORM_TYPE_COPY_DEFAULT: Dict[str, str] = {
    "received": "Vi har tagit emot din f&#246;rfr&#229;gan och &#229;terkommer s&#229; snart vi kan med information eller eventuella f&#246;ljdfr&#229;gor.",
    "followup": "Om du vill komplettera din f&#246;rfr&#229;gan eller har fr&#229;gor &#228;r du v&#228;lkommen att svara p&#229; detta e-postmeddelande eller kontakta oss direkt p&#229; uppgifterna nedan.",
}


def build_customer_confirmation_html(
    form_type: str,
    customer_name: str,
    summary_html: str = "",
) -> str:
    copy = _FORM_TYPE_COPY.get(form_type, _FORM_TYPE_COPY_DEFAULT)
    safe_name = html.escape((customer_name or "").strip())
    greeting = f"Hej {safe_name}," if safe_name else "Hej,"
    html_doc = f"""<!DOCTYPE html>
<html lang="sv">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
</head>
<body style="margin:0;padding:0;background:#f5f0e6;font-family:Georgia,'Times New Roman',serif;color:#0c1a2b;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e6;padding:40px 16px 48px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #d9cfbe;">

  <!-- Header -->
  <tr>
    <td style="background:#0c1a2b;padding:32px 40px 28px;text-align:center;">
      <img src="cid:henricssons-logo" alt="Henricssons B&#229;tkapell" width="156" style="display:block;width:156px;height:auto;border:0;margin:0 auto 20px;">
      <div style="width:40px;height:1px;background:#b28a4c;margin:0 auto 16px;"></div>
      <div style="color:#f5f0e6;font-size:11px;font-family:Arial,Helvetica,sans-serif;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;">Tack f&#246;r din f&#246;rfr&#229;gan</div>
    </td>
  </tr>

  <!-- Body -->
  <tr>
    <td style="padding:36px 40px 28px;background:#ffffff;">
      <p style="margin:0 0 16px;font-size:16px;line-height:1.75;color:#0c1a2b;">{greeting}</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.75;color:#1b2e47;">Tack f&#246;r att du kontaktade oss p&#229; Henricssons B&#229;tkapell.</p>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.75;color:#1b2e47;">{copy["received"]}</p>
      {summary_html}
      <p style="margin:0 0 28px;font-size:15px;line-height:1.75;color:#1b2e47;">{copy["followup"]}</p>

      <!-- Contact box -->
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e6;border-top:2px solid #b28a4c;margin-bottom:28px;">
        <tr>
          <td style="padding:20px 22px;">
            <div style="font-size:10px;font-family:Arial,Helvetica,sans-serif;color:#b28a4c;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;margin-bottom:12px;">Kontakta oss</div>
            <div style="font-size:14px;line-height:2;color:#0c1a2b;font-family:Arial,Helvetica,sans-serif;">
              <a href="tel:+46314718200" style="color:#0c1a2b;text-decoration:none;">+46 (0)31 47 18 20</a><br>
              <a href="mailto:info@henricssonsbatkapell.se" style="color:#b28a4c;text-decoration:none;">info@henricssonsbatkapell.se</a><br>
              Energigatan 17E, 434 37 Kungsbacka
            </div>
          </td>
        </tr>
      </table>

      <p style="margin:0;font-size:15px;line-height:1.7;color:#0c1a2b;">V&#228;nliga h&#228;lsningar<br><strong>Henricssons B&#229;tkapell</strong></p>
    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="background:#0c1a2b;padding:16px 40px;">
      <p style="margin:0;color:#6b7788;font-size:11px;font-family:Arial,Helvetica,sans-serif;text-align:center;line-height:1.6;letter-spacing:0.04em;">
        Du kan svara p&#229; detta e-postmeddelande s&#229; h&#246;r du fr&#229;n oss.
      </p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>"""
    return html_doc.encode("ascii", "xmlcharrefreplace").decode("ascii")


def make_mailgun_safe_text(text: str) -> str:
    return unicodedata.normalize("NFC", str(text or ""))


def make_mailgun_safe_html(html_body: str) -> str:
    return unicodedata.normalize("NFC", str(html_body or ""))


def build_customer_summary(fields: Dict[str, Any]) -> Tuple[str, str]:
    if not isinstance(fields, dict):
        return "", ""

    summary_keys = [
        "manufacturer",
        "model",
        "boat_year",
        "home_port",
        "quantity",
        "size",
        "subject",
        "message",
    ]
    rows: List[Tuple[str, str]] = []
    for key in summary_keys:
        value = _humanize_value(get_field_value(fields, key))
        if not value:
            continue
        if key == "message" and len(value) > 220:
            value = value[:217].rstrip() + "..."
        rows.append((_label(key), value))

    if not rows:
        return "", ""

    summary_html = (
        '<div style="margin:24px 0 20px;padding:20px 22px;background:#eae2d2;border-left:3px solid #b28a4c;">'
        '<div style="font-size:10px;color:#b28a4c;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;margin-bottom:14px;">Sammanfattning</div>'
        + "".join(
            f'<div style="font-size:13px;line-height:1.8;color:#0c1a2b;border-bottom:1px solid #d9cfbe;padding:5px 0;">'
            f'<span style="color:#6b7788;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;">{html.escape(label)}</span>'
            f'<br><span style="color:#0c1a2b;">{html.escape(value)}</span></div>'
            for label, value in rows
        )
        + '</div>'
    )
    summary_text = "Sammanfattning:\n" + "\n".join(
        f"- {label}: {value}" for label, value in rows
    ) + "\n\n"
    return summary_html, summary_text


def send_mailgun_email(
    *,
    recipients: List[str],
    subject: str,
    text_body: str,
    html_body: str,
    inline_attachments: Optional[List[Tuple[str, bytes, str]]] = None,
    regular_attachments: Optional[List[Tuple[str, bytes, str]]] = None,
) -> Tuple[bool, str]:
    if not MAILGUN_DOMAIN:
        return False, "MAILGUN_DOMAIN missing"
    if not MAILGUN_API_KEY:
        return False, "MAILGUN_API_KEY missing"
    if not MAILGUN_FROM:
        return False, "MAILGUN_FROM missing"
    if not recipients:
        return False, "MAILGUN_TO missing/empty"

    data = {
        "from": MAILGUN_FROM,
        "to": recipients,
        "subject": make_mailgun_safe_text(subject),
        "text": make_mailgun_safe_text(text_body),
        "html": make_mailgun_safe_html(html_body),
    }
    files: List[Tuple[str, Tuple[str, bytes, str]]] = []
    for name, blob, mime in inline_attachments or []:
        files.append(("inline", (name, blob, mime)))
    for name, blob, mime in regular_attachments or []:
        files.append(("attachment", (name, blob, mime)))

    try:
        kwargs: Dict[str, Any] = {
            "auth": ("api", MAILGUN_API_KEY),
            "data": data,
            "timeout": 30,
        }
        if files:
            kwargs["files"] = files
        response = requests.post(
            f"{MAILGUN_API_BASE}/v3/{MAILGUN_DOMAIN}/messages",
            **kwargs,
        )
        if response.status_code >= 400:
            return False, f"HTTP {response.status_code}: {response.text}"
        return True, response.text.strip()
    except Exception as exc:
        return False, str(exc)


def sanitize_attachment_filename(raw_name: str, fallback_ext: str = "") -> str:
    name = str(raw_name or "").strip().replace("\\", "/").split("/")[-1]
    name = re.sub(r"[^A-Za-z0-9_.\- ()]+", "_", name)
    name = name.strip() or "bilaga"
    if "." not in name and fallback_ext:
        name = f"{name}{fallback_ext}"
    return name[:120]


def normalize_attachment_mime(filename: str, mime: str) -> str:
    ext = os.path.splitext(filename or "")[1].lower()
    normalized = str(mime or "").strip().lower()
    if not normalized or normalized == "application/octet-stream":
        normalized = ATTACHMENT_MIME_BY_EXT.get(ext, normalized or "application/octet-stream")
    return normalized


def save_submission_attachments(submission_id: str, files: List[Any]) -> List[Dict[str, Any]]:
    """Persist uploaded files to the DB and return attachment metadata."""
    saved: List[Dict[str, Any]] = []
    if not files:
        return saved
    db = get_db()
    if not db:
        return saved
    try:
        total_bytes = 0
        kept = 0
        for file_storage in files:
            if kept >= MAX_ATTACHMENTS_PER_SUBMISSION:
                break
            if file_storage is None or not getattr(file_storage, "filename", ""):
                continue
            raw_name = file_storage.filename
            ext = os.path.splitext(raw_name)[1].lower()
            if ext and ext not in ATTACHMENT_ALLOWED_EXTS:
                continue
            mime = normalize_attachment_mime(raw_name, getattr(file_storage, "mimetype", ""))
            if not any(mime.startswith(p) for p in ATTACHMENT_ALLOWED_MIME_PREFIXES):
                continue
            try:
                file_storage.stream.seek(0)
            except Exception:
                pass
            try:
                blob = file_storage.read()
            except Exception:
                continue
            if not blob:
                continue
            if len(blob) > MAX_ATTACHMENT_BYTES:
                continue
            if total_bytes + len(blob) > MAX_TOTAL_ATTACHMENT_BYTES:
                break
            filename = sanitize_attachment_filename(raw_name, fallback_ext=ext)
            record = SubmissionAttachment(
                submission_id=submission_id,
                filename=filename,
                mime=mime,
                size=len(blob),
                data=blob,
            )
            db.add(record)
            db.flush()
            saved.append({
                "id": record.id,
                "submission_id": submission_id,
                "filename": filename,
                "mime": mime,
                "size": len(blob),
                "bytes": blob,
            })
            total_bytes += len(blob)
            kept += 1
        db.commit()
    except Exception as exc:
        print(f"save_submission_attachments failed: {exc}")
        db.rollback()
        saved = []
    finally:
        db.close()
    return saved


def get_submission_attachments_meta(submission_id: str) -> List[Dict[str, Any]]:
    db = get_db()
    if not db:
        return []
    try:
        rows = (
            db.query(SubmissionAttachment)
            .filter_by(submission_id=submission_id)
            .order_by(SubmissionAttachment.id.asc())
            .all()
        )
        return [row.to_meta() for row in rows]
    except Exception:
        return []
    finally:
        db.close()


def send_mailgun_submission_notification(
    submission: Dict[str, Any],
    attachments: Optional[List[Dict[str, Any]]] = None,
) -> None:
    recipients = get_mailgun_recipients()
    form_type = str(submission.get("form_type", "Kontakt"))
    fields = submission.get("fields", {})
    if not isinstance(fields, dict):
        fields = {}
    submission_id = str(submission.get("id", ""))
    timestamp_iso = str(submission.get("timestamp", ""))
    proposed_response = ""
    form_label = FORM_TYPE_LABELS_SV.get(form_type, form_type)
    notification_form_label = NOTIFICATION_FORM_LABELS_SV.get(form_type, form_label)
    preview_title, preview_message = build_submission_notification_preview(fields)
    subject = f"Ny {notification_form_label}"
    field_lines = "\n".join(
        f"  {_label(k)}: {_humanize_value(v)}"
        for k, v in fields.items()
        if k != "__submitted_via" and _humanize_value(v)
    )
    attachment_lines = ""
    attachments = attachments or []
    # Enrich attachments with cid + public_url
    enriched: List[Dict[str, Any]] = []
    inline_files: List[Tuple[str, bytes, str]] = []
    regular_files: List[Tuple[str, bytes, str]] = []
    try:
        inline_files.append(("henricssons-logo", LOGO_FILE.read_bytes(), "image/png"))
    except Exception as exc:
        print(f"Could not attach notification logo: {exc}")
    for idx, att in enumerate(attachments):
        blob = att.get("bytes")
        if not isinstance(blob, (bytes, bytearray)):
            continue
        filename = str(att.get("filename", f"bilaga-{idx+1}"))
        mime = str(att.get("mime", "application/octet-stream"))
        ext = os.path.splitext(filename)[1].lower() or ".jpg"
        cid = f"attachment-{att.get('id', idx)}{ext}"
        att_id = att.get('id', '')
        token = sign_attachment_token(int(att_id)) if isinstance(att_id, int) or (isinstance(att_id, str) and att_id.isdigit()) else ""
        public_url = f"{PUBLIC_ATTACHMENT_BASE_URL}/api/attachment/{att_id}"
        if token:
            public_url = f"{public_url}?token={token}"
        enriched.append({
            "cid": cid,
            "filename": filename,
            "mime": mime,
            "size": att.get("size", len(blob)),
            "public_url": public_url,
        })
        if mime.startswith("image/"):
            inline_files.append((cid, bytes(blob), mime))
            regular_files.append((filename, bytes(blob), mime))
        else:
            regular_files.append((filename, bytes(blob), mime))
    if enriched:
        attachment_lines = "\n\nBifogade filer:\n" + "\n".join(
            f"  - {a['filename']} ({max(1, int(a['size']/1024))} KB) {a['public_url']}"
            for a in enriched
        )
    ai_reply_lines = ""
    preview_lines = "\n".join(line for line in [preview_title, preview_message] if line)
    if preview_lines:
        preview_lines += "\n\n"
    text_body = (
        f"{preview_lines}"
        f"{field_lines}"
        f"{attachment_lines}\n\n"
        f"{ai_reply_lines}"
        f"Tid (UTC): {timestamp_iso}\n"
        f"ID: {submission_id}\n"
    )
    html_body = build_notification_html(
        form_type,
        fields,
        submission_id,
        timestamp_iso,
        attachments=enriched,
        proposed_response=proposed_response,
        preview_title=preview_title,
        preview_message=preview_message,
    )
    ok, info = send_mailgun_email(
        recipients=recipients,
        subject=subject,
        text_body=text_body,
        html_body=html_body,
        inline_attachments=inline_files,
        regular_attachments=regular_files,
    )
    if not ok:
        print(f"Mailgun notification failed: {info}")


def send_mailgun_customer_confirmation(submission: Dict[str, Any]) -> None:
    form_type = str(submission.get("form_type", "Kontakt"))
    fields = submission.get("fields", {})
    if not isinstance(fields, dict):
        return

    customer_email = get_field_value(fields, "email", "e-post", "e-postadress")
    if not is_valid_email_address(customer_email):
        return

    customer_name = get_field_value(fields, "name", "namn")
    form_label = FORM_TYPE_LABELS_SV.get(form_type, form_type)
    summary_html, summary_text = build_customer_summary(fields)
    subject = f"Tack för att du kontaktade oss - {form_label}"
    text_body = (
        f"Tack för att du kontaktade oss på Henricssons Båtkapell.\n\n"
        f"Vi har tagit emot din {form_label.lower()} och återkommer så snart vi kan "
        f"med information eller eventuella frågor.\n\n"
        f"{summary_text}"
        f"Om du vill komplettera din förfrågan under tiden kan du kontakta oss med uppgifterna nedan.\n\n"
        f"Telefon: +46 (0)31 47 18 20\n"
        f"E-post: info@henricssonsbatkapell.se\n"
        f"Adress: Energigatan 17E, 434 37 Kungsbacka\n\n"
        f"Vänliga hälsningar\n"
        f"Henricssons Båtkapell\n"
    )
    html_body = build_customer_confirmation_html(form_type, customer_name, summary_html=summary_html)
    inline_files: List[Tuple[str, bytes, str]] = []
    try:
        inline_files.append(("henricssons-logo", LOGO_FILE.read_bytes(), "image/png"))
    except Exception as exc:
        print(f"Could not attach confirmation logo: {exc}")
    ok, info = send_mailgun_email(
        recipients=[customer_email],
        subject=subject,
        text_body=text_body,
        html_body=html_body,
        inline_attachments=inline_files,
    )
    if not ok:
        print(f"Customer confirmation failed: {info}")


def process_form_submission(
    form_type: str,
    fields: Dict[str, Any],
    submitted_via: str = "web_form",
    upload_files: Optional[List[Any]] = None,
) -> str:
    normalized_form_type = display_form_type(form_type)
    safe_fields = sanitize_fields(fields, submitted_via=submitted_via)
    form_summary = build_form_summary(normalized_form_type, safe_fields)
    category, title = generate_submission_metadata(normalized_form_type, safe_fields, form_summary)
    submission_id = f"form_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{os.urandom(4).hex()}"
    submission = {
        "id": submission_id,
        "form_type": normalized_form_type,
        "category": category,
        "title": title,
        "fields": safe_fields,
        "form_summary": form_summary,
        "proposed_response": "",
        "timestamp": datetime.utcnow().isoformat(),
        "status": "nya-inskick",
        "read": False,
        "submitted_via": submitted_via,
    }
    save_submission_record(submission)
    saved_attachments = save_submission_attachments(submission_id, upload_files or [])
    send_mailgun_submission_notification(submission, attachments=saved_attachments)
    send_mailgun_customer_confirmation(submission)
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
        copy_row["attachments"] = []
        file_normalized.append(copy_row)

    # Prefetch attachments per submission id (one query rather than N+1)
    attachments_by_sub: Dict[str, List[Dict[str, Any]]] = {}
    db_for_attachments = get_db()
    if db_for_attachments:
        try:
            rows = (
                db_for_attachments.query(SubmissionAttachment)
                .order_by(SubmissionAttachment.id.asc())
                .all()
            )
            for row in rows:
                attachments_by_sub.setdefault(row.submission_id, []).append(row.to_meta())
        except Exception:
            pass
        finally:
            db_for_attachments.close()
    for row in file_normalized:
        row_id = str(row.get("id", "")).strip()
        if row_id and row_id in attachments_by_sub:
            row["attachments"] = attachments_by_sub[row_id]

    db = get_db()
    if db:
        try:
            rows = db.query(FormSubmission).order_by(FormSubmission.timestamp.desc()).all()
            db_rows = [row.to_dict() for row in rows]
            for row in db_rows:
                row_id = str(row.get("id", "")).strip()
                row["attachments"] = attachments_by_sub.get(row_id, [])
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


def truncate_admin_context_text(value: Any, limit: int = MAX_ADMIN_CONTEXT_TEXT_CHARS) -> str:
    text = str(value or "").strip()
    if len(text) <= limit:
        return text
    return f"{text[:limit].rstrip()}... [kortad]"


def label_submission_field_for_admin(key: str) -> str:
    clean_key = re.sub(r"^\d+\.\s*", "", str(key or "").strip())
    canonical_key = canonicalize_draft_key(clean_key)
    return _label(canonical_key or clean_key)


def build_admin_chat_context() -> Dict[str, Any]:
    submissions = get_all_submissions()
    normalized_submissions: List[Dict[str, Any]] = []

    for row in submissions:
        fields = row.get("fields", {})
        if not isinstance(fields, dict):
            fields = {}
        visible_fields: List[Dict[str, str]] = []
        for key, value in fields.items():
            if str(key).startswith("__"):
                continue
            rendered_value = truncate_admin_context_text(value, MAX_ADMIN_CONTEXT_FIELD_CHARS)
            if not rendered_value:
                continue
            visible_fields.append(
                {
                    "label": label_submission_field_for_admin(str(key)),
                    "key": str(key),
                    "value": rendered_value,
                }
            )

        attachments = row.get("attachments", [])
        attachment_items: List[Dict[str, Any]] = []
        if isinstance(attachments, list):
            for attachment in attachments:
                if not isinstance(attachment, dict):
                    continue
                attachment_items.append(
                    {
                        "filename": str(attachment.get("original_name") or attachment.get("filename") or ""),
                        "is_image": bool(attachment.get("is_image")),
                        "url": str(attachment.get("url") or ""),
                    }
                )

        normalized_submissions.append(
            {
                "id": str(row.get("id", "") or ""),
                "form_type": FORM_TYPE_LABELS_SV.get(str(row.get("form_type", "")), str(row.get("form_type", ""))),
                "raw_form_type": str(row.get("form_type", "") or ""),
                "title": str(row.get("title", "") or ""),
                "category": str(row.get("category", "") or ""),
                "status": str(row.get("status", "") or "nya-inskick"),
                "read": bool(row.get("read", False)),
                "submitted_via": str(row.get("submitted_via", "") or ""),
                "timestamp": str(row.get("timestamp", "") or row.get("date", "") or ""),
                "notes": truncate_admin_context_text(row.get("notes", ""), 1200),
                "summary": truncate_admin_context_text(row.get("form_summary", ""), 1200),
                "proposed_response": truncate_admin_context_text(row.get("proposed_response", ""), 1500),
                "fields": visible_fields,
                "attachments": attachment_items,
            }
        )

    return {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "site": {
            "name": "Henricssons Båtkapell",
            "public_url": PUBLIC_BASE_URL,
            "public_pages": CORE_PUBLIC_PATHS,
            "forms": {
                "Kapellförfrågan": "Kund skickar namn, telefon, e-post, båttillverkare, modell, årsmodell, hemmahamn, eventuell befintlig kapelltillverkare, meddelande och bilagor.",
                "Fenderförfrågan": "Kund skickar namn, telefon, e-post, adress, antal, storlek och bilagor.",
                "Kontakt": "Kund skickar namn, e-post, telefon, ämne och meddelande.",
            },
        },
        "admin_panel": {
            "statuses": {
                "nya-inskick": "Nytt inkommet ärende som normalt bör granskas först.",
                "vantar-pa-svar": "Ärende där Henricssons väntar på svar eller komplettering.",
                "i-produktion": "Ärende markerat som pågående produktion.",
                "redo-for-leverans": "Ärende som är klart eller nära leverans.",
            },
            "important_rules": [
                "Använd submissions-listan som sanningskälla när du rangordnar ärenden eller skriver kundsvar.",
                "När användaren nämner en kund vid namn, matcha mot fälten Namn, titel, sammanfattning och meddelande.",
                "Status, interna anteckningar och föreslagna svar ska vägas in i prioriteringar.",
                "Om fakta saknas i inskicket ska du säga exakt vad som saknas i stället för att gissa.",
            ],
        },
        "submissions_total": len(normalized_submissions),
        "submissions": normalized_submissions,
    }


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


def update_submission_response_record(submission_id: str, proposed_response: str) -> bool:
    response_text = str(proposed_response or "").strip()
    updated = False
    db = get_db()
    if db:
        try:
            row = db.query(FormSubmission).filter_by(id=submission_id).first()
            if row:
                row.proposed_response = response_text
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
            row["proposed_response"] = response_text
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
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
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
    existing_cache_control = response.headers.get("Cache-Control", "").lower().strip()
    has_explicit_cache_control = existing_cache_control and existing_cache_control != "no-cache"
    if request.method == "GET" and not path_lower.startswith("/api/") and not has_explicit_cache_control:
        if path_lower in {"/admin", "/admin.html"}:
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        elif path_lower == "/" or path_lower.endswith(".html"):
            response.headers["Cache-Control"] = "no-cache, max-age=0, must-revalidate"
        elif path_lower.endswith((".css", ".js")):
            response.headers["Cache-Control"] = "public, max-age=86400, stale-while-revalidate=604800"
        elif path_lower.endswith(".json"):
            response.headers["Cache-Control"] = "public, max-age=60, stale-while-revalidate=300"
        elif path_lower.endswith((".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".ico")):
            response.headers["Cache-Control"] = "public, max-age=604800, stale-while-revalidate=2592000"
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

    upload_files: List[Any] = []
    fields: Dict[str, Any] = {}
    form_type = "Kontakt"
    submitted_via = "web_form"

    content_type = (request.content_type or "").lower()
    if content_type.startswith("multipart/form-data"):
        raw_payload = request.form.get("payload")
        if raw_payload:
            try:
                parsed = json.loads(raw_payload)
            except Exception:
                return jsonify(error="Invalid payload JSON"), 400
            if not isinstance(parsed, dict):
                return jsonify(error="Invalid payload"), 400
            maybe_fields = parsed.get("fields", {})
            if isinstance(maybe_fields, dict):
                fields = maybe_fields
            form_type = str(parsed.get("form_type", "Kontakt") or "Kontakt")
            submitted_via = str(parsed.get("submitted_via", "web_form") or "web_form")
        # Files under key "attachments"
        files_list = request.files.getlist("attachments")
        if files_list:
            upload_files = files_list[:MAX_ATTACHMENTS_PER_SUBMISSION]
    else:
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return jsonify(error="Form data required"), 400
        maybe_fields = payload.get("fields", {})
        if not isinstance(maybe_fields, dict):
            return jsonify(error="Invalid fields"), 400
        fields = maybe_fields
        form_type = str(payload.get("form_type", "Kontakt") or "Kontakt")
        submitted_via = str(payload.get("submitted_via", "web_form") or "web_form")

    bot_error = validate_public_form_submission(fields, submitted_via)
    if bot_error:
        payload, status_code = bot_error
        return jsonify(payload), status_code

    try:
        submission_id = process_form_submission(
            form_type,
            fields,
            submitted_via=submitted_via,
            upload_files=upload_files,
        )
        return jsonify(success=True, submission_id=submission_id, attachments=len(upload_files))
    except Exception as exc:
        return jsonify(error=f"Server error: {exc}"), 500


@app.route("/api/attachment/<int:attachment_id>", methods=["GET"])
def get_attachment(attachment_id: int):
    """Fetch a single attachment. Accepts admin session or a signed ?token= query param."""
    token = request.args.get("token", "").strip()
    if not (check_admin_access() or verify_attachment_token(attachment_id, token)):
        return jsonify(error="Admin authorization required"), 403
    db = get_db()
    if not db:
        return jsonify(error="Database unavailable"), 503
    try:
        row = db.query(SubmissionAttachment).filter_by(id=attachment_id).first()
        if not row:
            return jsonify(error="Not found"), 404
        response = Response(row.data, mimetype=row.mime or "application/octet-stream")
        safe_name = sanitize_attachment_filename(row.filename or f"attachment-{row.id}")
        disposition = "inline" if str(row.mime or "").startswith("image/") else "attachment"
        response.headers["Content-Disposition"] = f'{disposition}; filename="{safe_name}"'
        response.headers["Content-Length"] = str(len(row.data or b""))
        response.headers["Cache-Control"] = "private, max-age=3600"
        return response
    except Exception as exc:
        return jsonify(error=str(exc)), 500
    finally:
        db.close()


@app.route("/api/submission_attachments", methods=["GET"])
@admin_required
def submission_attachments_route():
    submission_id = str(request.args.get("submission_id", "")).strip()
    if not submission_id:
        return jsonify(error="submission_id required"), 400
    return jsonify(get_submission_attachments_meta(submission_id))


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


@app.route("/api/generate_submission_response", methods=["POST"])
@admin_required
def generate_submission_response_route():
    payload = request.get_json()
    if not isinstance(payload, dict):
        return jsonify(error="Invalid payload"), 400
    submission_id = str(payload.get("id", "")).strip()
    if not submission_id:
        return jsonify(error="Missing id"), 400

    submission = next((row for row in get_all_submissions() if str(row.get("id", "")) == submission_id), None)
    if not submission:
        return jsonify(error="Submission not found"), 404
    fields = submission.get("fields", {})
    if not isinstance(fields, dict):
        fields = {}
    form_type = str(submission.get("form_type", "Kontakt") or "Kontakt")
    form_summary = str(submission.get("form_summary", "") or "")
    try:
        response_text = generate_submission_ai_response(form_type, fields, form_summary)
    except Exception as exc:
        return jsonify(error=f"AI unavailable: {exc}"), 502
    if not update_submission_response_record(submission_id, response_text):
        return jsonify(error="Submission not found"), 404
    return jsonify(success=True, proposed_response=response_text)


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
        return jsonify({"announcement": {"text": ""}})

    if not check_admin_access():
        return jsonify(error="Admin authorization required"), 403
    data = request.get_json()
    if not isinstance(data, dict):
        return jsonify(error="Invalid payload"), 400
    write_json_file(PAGE_TEXTS_FILE, data)
    set_site_content("page_texts", data)
    return jsonify(success=True)


@app.route("/api/mailgun_settings", methods=["GET", "POST"])
@admin_required
def mailgun_settings_route():
    if request.method == "GET":
        return jsonify(load_mailgun_settings())

    data = request.get_json()
    if not isinstance(data, dict):
        return jsonify(error="Invalid payload"), 400
    try:
        saved = save_mailgun_settings(data)
    except ValueError as exc:
        return jsonify(error=str(exc)), 400
    return jsonify(success=True, **saved)


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


TEMP_PRODUCT_MAX_IMAGE_BYTES = 8 * 1024 * 1024
TEMP_PRODUCT_MAX_IMAGES = 12
TEMP_PRODUCT_ALLOWED_MIMES = {"image/jpeg", "image/png", "image/webp", "image/gif"}


def slugify_temp_product(value: Any, fallback: str = "produkt") -> str:
    raw = unicodedata.normalize("NFKD", str(value or ""))
    ascii_value = raw.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", ascii_value.lower()).strip("-")
    return slug or fallback


def enrich_temp_products(products: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    used_slugs: set[str] = set()
    enriched: List[Dict[str, Any]] = []
    for item in products:
        product = dict(item)
        base_slug = slugify_temp_product(product.get("title"), fallback=f"produkt-{product.get('id') or 'x'}")
        slug = base_slug
        suffix = 2
        while slug in used_slugs:
            slug = f"{base_slug}-{suffix}"
            suffix += 1
        used_slugs.add(slug)
        product["slug"] = slug
        product["href"] = f"/tillfalliga-produkter/{slug}"
        images = product.get("images") if isinstance(product.get("images"), list) else []
        product["images"] = images
        product["primary_image_url"] = images[0]["url"] if images else ""
        product["share_title"] = f"{str(product.get('title') or 'Tillfällig produkt').strip()} - Henricssons Båtkapell"
        description = str(product.get("description") or "").strip()
        product["share_description"] = (description[:157].rstrip() + "...") if len(description) > 160 else description
        enriched.append(product)
    return enriched


def get_public_temp_products() -> List[Dict[str, Any]]:
    return enrich_temp_products(_fetch_temp_products())


def get_temp_product_by_slug(slug: str) -> Tuple[Optional[Dict[str, Any]], List[Dict[str, Any]]]:
    products = get_public_temp_products()
    clean_slug = str(slug or "").strip().strip("/")
    for product in products:
        if product.get("slug") == clean_slug:
            return product, products
    return None, products


def _fetch_temp_products(include_images: bool = True) -> List[Dict[str, Any]]:
    db = get_db()
    if not db:
        return []
    try:
        rows = db.query(TempProduct).order_by(TempProduct.sort_order.asc(), TempProduct.id.asc()).all()
        images_by_product: Dict[int, List[Dict[str, Any]]] = {}
        if include_images and rows:
            img_rows = (
                db.query(TempProductImage)
                .order_by(TempProductImage.sort_order.asc(), TempProductImage.id.asc())
                .all()
            )
            for img in img_rows:
                images_by_product.setdefault(img.product_id, []).append(img.to_meta())
        return [row.to_dict(images=images_by_product.get(row.id, [])) for row in rows]
    except Exception as exc:
        print(f"fetch_temp_products failed: {exc}")
        return []
    finally:
        db.close()


@app.route("/api/temp_products", methods=["GET"])
def list_temp_products_public():
    return jsonify(get_public_temp_products())


@app.route("/api/temp_products", methods=["POST"])
@admin_required
def create_temp_product():
    payload = request.get_json(silent=True) or {}
    if not isinstance(payload, dict):
        return jsonify(error="Invalid payload"), 400
    db = get_db()
    if not db:
        return jsonify(error="Database unavailable"), 503
    try:
        next_order = (db.query(TempProduct).count() or 0)
        product = TempProduct(
            title=str(payload.get("title", "") or "").strip()[:300],
            description=str(payload.get("description", "") or "").strip()[:4000],
            price=str(payload.get("price", "") or "").strip()[:100],
            sort_order=int(payload.get("sort_order", next_order) or next_order),
        )
        db.add(product)
        db.commit()
        db.refresh(product)
        return jsonify(product.to_dict())
    except Exception as exc:
        db.rollback()
        return jsonify(error=str(exc)), 500
    finally:
        db.close()


@app.route("/api/temp_products/<int:product_id>", methods=["PUT"])
@admin_required
def update_temp_product(product_id: int):
    payload = request.get_json(silent=True) or {}
    if not isinstance(payload, dict):
        return jsonify(error="Invalid payload"), 400
    db = get_db()
    if not db:
        return jsonify(error="Database unavailable"), 503
    try:
        product = db.query(TempProduct).filter_by(id=product_id).first()
        if not product:
            return jsonify(error="Not found"), 404
        if "title" in payload:
            product.title = str(payload.get("title", "") or "").strip()[:300]
        if "description" in payload:
            product.description = str(payload.get("description", "") or "").strip()[:4000]
        if "price" in payload:
            product.price = str(payload.get("price", "") or "").strip()[:100]
        if "sort_order" in payload:
            try:
                product.sort_order = int(payload.get("sort_order") or 0)
            except (TypeError, ValueError):
                pass
        db.commit()
        db.refresh(product)
        return jsonify(product.to_dict())
    except Exception as exc:
        db.rollback()
        return jsonify(error=str(exc)), 500
    finally:
        db.close()


@app.route("/api/temp_products/<int:product_id>", methods=["DELETE"])
@admin_required
def delete_temp_product(product_id: int):
    db = get_db()
    if not db:
        return jsonify(error="Database unavailable"), 503
    try:
        product = db.query(TempProduct).filter_by(id=product_id).first()
        if not product:
            return jsonify(error="Not found"), 404
        # Explicitly delete images in case cascade isn't configured on the engine
        db.query(TempProductImage).filter_by(product_id=product_id).delete(synchronize_session=False)
        db.delete(product)
        db.commit()
        return jsonify(success=True)
    except Exception as exc:
        db.rollback()
        return jsonify(error=str(exc)), 500
    finally:
        db.close()


@app.route("/api/temp_products/<int:product_id>/images", methods=["POST"])
@admin_required
def upload_temp_product_image(product_id: int):
    db = get_db()
    if not db:
        return jsonify(error="Database unavailable"), 503
    try:
        product = db.query(TempProduct).filter_by(id=product_id).first()
        if not product:
            return jsonify(error="Product not found"), 404

        existing_count = db.query(TempProductImage).filter_by(product_id=product_id).count()
        files = request.files.getlist("images") or request.files.getlist("image")
        if not files:
            return jsonify(error="No images provided"), 400

        saved: List[Dict[str, Any]] = []
        next_order = existing_count
        for file_storage in files:
            if existing_count + len(saved) >= TEMP_PRODUCT_MAX_IMAGES:
                break
            raw_name = getattr(file_storage, "filename", "") or f"image-{int(time.time())}"
            mime = (getattr(file_storage, "mimetype", "") or "").lower()
            if mime not in TEMP_PRODUCT_ALLOWED_MIMES:
                ext = os.path.splitext(raw_name)[1].lower()
                mime = {
                    ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                    ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
                }.get(ext, "")
                if mime not in TEMP_PRODUCT_ALLOWED_MIMES:
                    continue
            blob = file_storage.read()
            if not blob or len(blob) > TEMP_PRODUCT_MAX_IMAGE_BYTES:
                continue
            image = TempProductImage(
                product_id=product_id,
                filename=sanitize_attachment_filename(raw_name, fallback_ext=os.path.splitext(raw_name)[1]),
                mime=mime,
                data=blob,
                sort_order=next_order,
            )
            db.add(image)
            db.flush()
            saved.append(image.to_meta())
            next_order += 1
        db.commit()
        return jsonify(success=True, images=saved)
    except Exception as exc:
        db.rollback()
        return jsonify(error=str(exc)), 500
    finally:
        db.close()


@app.route("/api/temp_product_image/<int:image_id>", methods=["GET"])
def get_temp_product_image(image_id: int):
    db = get_db()
    if not db:
        return jsonify(error="Database unavailable"), 503
    try:
        row = db.query(TempProductImage).filter_by(id=image_id).first()
        if not row:
            return jsonify(error="Not found"), 404
        response = Response(row.data, mimetype=row.mime or "image/jpeg")
        response.headers["Cache-Control"] = "public, max-age=86400"
        response.headers["Content-Length"] = str(len(row.data or b""))
        return response
    except Exception as exc:
        return jsonify(error=str(exc)), 500
    finally:
        db.close()


@app.route("/api/temp_product_image/<int:image_id>", methods=["DELETE"])
@admin_required
def delete_temp_product_image(image_id: int):
    db = get_db()
    if not db:
        return jsonify(error="Database unavailable"), 503
    try:
        row = db.query(TempProductImage).filter_by(id=image_id).first()
        if not row:
            return jsonify(error="Not found"), 404
        db.delete(row)
        db.commit()
        return jsonify(success=True)
    except Exception as exc:
        db.rollback()
        return jsonify(error=str(exc)), 500
    finally:
        db.close()


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
        if not isinstance(data, dict):
            data = read_json_file(MODELS_META_FILE, {})
        normalized = normalize_example_payload(data)
        return app.response_class(json.dumps(normalized, ensure_ascii=False), mimetype="application/json")

    full_path = (IMAGES_ROOT / filename).resolve()
    if IMAGES_ROOT not in full_path.parents:
        return jsonify(error="Invalid path"), 400
    if full_path.exists() and full_path.is_file():
        return send_from_directory(str(full_path.parent), full_path.name)
    return jsonify(error="File not found"), 404


@app.route("/examples_meta.json")
def get_examples_meta():
    data = get_site_content("examples_meta")
    if not isinstance(data, dict):
        data = read_json_file(EXAMPLES_META_FILE, {})
    normalized = normalize_example_payload(data)
    return app.response_class(json.dumps(normalized, ensure_ascii=False), mimetype="application/json")


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
        admin_context = build_admin_chat_context()
        admin_system_prompt = (
            f"{custom_prompt}\n\n"
            "Du har nu full admin-context i användarmeddelandet som JSON. "
            "Den innehåller alla formulärinskick, statusar, interna anteckningar, bilagor, föreslagna svar och hur formulären fungerar. "
            "Svara på svenska om användaren skriver svenska. "
            "När du hänvisar till ett specifikt inskick: nämn kundnamn om det finns, status och kort varför. "
            "När du skriver kundsvar: skriv bara svaret som kan skickas, utan intern analys."
        )
        admin_payload = json.dumps(
            {
                "admin_question": message,
                "admin_context": admin_context,
            },
            ensure_ascii=False,
        )
        answer = get_openai_response(admin_payload, admin_system_prompt, 0.4, 1800, model=ADMIN_CHAT_MODEL)
        return jsonify(success=True, response=answer)
    except Exception as exc:
        return jsonify(error=str(exc)), 500


@app.route("/api/assistant_chat", methods=["POST", "OPTIONS"])
def assistant_chat():
    if request.method == "OPTIONS":
        return "", 200
    if not is_public_chatbot_enabled():
        return jsonify(error="Chatbot disabled"), 404
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
    if not is_public_chatbot_enabled():
        return jsonify(error="Chatbot disabled"), 404
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

    has_multiple = len(image_urls) > 1
    gallery_images = "".join(
        f'<button type="button" class="seo-thumb{" is-active" if index == 0 else ""}" data-gallery-index="{index}" aria-label="Visa bild {index + 1}">'
        f'<img src="{html.escape(image)}" alt="{html.escape(full_title)}" loading="lazy" decoding="async"/></button>'
        for index, image in enumerate(image_urls[:8])
    )
    nav_style = "" if has_multiple else ' style="display:none"'
    thumbs_style = "" if has_multiple else ' style="display:none"'

    gallery_html = f"""
    <div class="seo-gallery">
        <div class="seo-gallery-stage">
            <button type="button" class="seo-gallery-nav seo-gallery-prev" aria-label="Föregående bild"{nav_style}>&#8249;</button>
            <div class="seo-gallery-main">
                <img id="seoGalleryMainImage" src="{html.escape(image_urls[0])}" alt="{html.escape(full_title)}" loading="eager" decoding="async" fetchpriority="high"/>
                <button type="button" class="seo-gallery-expand" aria-label="Öppna bilden större">Öppna större</button>
            </div>
            <button type="button" class="seo-gallery-nav seo-gallery-next" aria-label="Nästa bild"{nav_style}>&#8250;</button>
        </div>
        <div class="seo-thumbs"{thumbs_style}>
            {gallery_images}
        </div>
        <div class="seo-lightbox" id="seoGalleryLightbox" aria-hidden="true">
            <button type="button" class="seo-lightbox-close" aria-label="Stäng">&times;</button>
            <button type="button" class="seo-lightbox-nav seo-lightbox-prev" aria-label="Föregående bild"{nav_style}>&#8249;</button>
            <div class="seo-lightbox-stage">
                <img id="seoLightboxImage" src="{html.escape(image_urls[0])}" alt="{html.escape(full_title)}" loading="lazy" decoding="async"/>
            </div>
            <button type="button" class="seo-lightbox-nav seo-lightbox-next" aria-label="Nästa bild"{nav_style}>&#8250;</button>
            <div class="seo-lightbox-actions">
                <button type="button" class="seo-lightbox-fullscreen" id="seoLightboxFullscreen">Fullskärm</button>
            </div>
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

    contact_href = build_contact_example_href(manufacturer, model, canonical_slug)
    kapell_href = build_kapell_example_href(manufacturer, model, canonical_slug)

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
            <a class="seo-btn seo-btn-primary" href="{html.escape(kapell_href)}">Kapellförfrågan</a>
            <a class="seo-btn" href="{html.escape(contact_href)}">Mer information</a>
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
                <a href="/">Start</a><span>/</span><a href="/bilder-och-exempel">Bilder &amp; exempel</a><span>/</span><span>{html.escape(full_title)}</span>
            </div>
            <div class="seo-kicker">{html.escape(str(item.get('category', '') or 'Exempel'))}</div>
            <h1>{html.escape(full_title)}</h1>
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
    <script>
        (function () {{
            const images = {json.dumps(image_urls[:8])};
            const mainImage = document.getElementById('seoGalleryMainImage');
            const thumbs = Array.from(document.querySelectorAll('.seo-thumb'));
            const prevButton = document.querySelector('.seo-gallery-prev');
            const nextButton = document.querySelector('.seo-gallery-next');
            const expandButton = document.querySelector('.seo-gallery-expand');
            const lightbox = document.getElementById('seoGalleryLightbox');
            const lightboxImage = document.getElementById('seoLightboxImage');
            const lightboxClose = document.querySelector('.seo-lightbox-close');
            const lightboxPrev = document.querySelector('.seo-lightbox-prev');
            const lightboxNext = document.querySelector('.seo-lightbox-next');
            const lightboxFullscreen = document.getElementById('seoLightboxFullscreen');
            const imageAlt = {json.dumps(full_title)};
            let currentIndex = 0;

            function render(index) {{
                currentIndex = (index + images.length) % images.length;
                if (mainImage) {{
                    mainImage.src = images[currentIndex];
                    mainImage.alt = imageAlt;
                }}
                if (lightboxImage) {{
                    lightboxImage.src = images[currentIndex];
                    lightboxImage.alt = imageAlt;
                }}
                thumbs.forEach((thumb, i) => thumb.classList.toggle('is-active', i === currentIndex));
            }}

            function openLightbox(index) {{
                if (!lightbox) return;
                render(typeof index === 'number' ? index : currentIndex);
                lightbox.classList.add('is-open');
                lightbox.setAttribute('aria-hidden', 'false');
                document.body.style.overflow = 'hidden';
            }}

            function closeLightbox() {{
                if (!lightbox) return;
                lightbox.classList.remove('is-open');
                lightbox.setAttribute('aria-hidden', 'true');
                document.body.style.overflow = '';
            }}

            thumbs.forEach((thumb, index) => thumb.addEventListener('click', () => render(index)));
            if (prevButton && images.length > 1) prevButton.addEventListener('click', () => render(currentIndex - 1));
            if (nextButton && images.length > 1) nextButton.addEventListener('click', () => render(currentIndex + 1));
            if (mainImage) mainImage.addEventListener('click', () => openLightbox(currentIndex));
            if (expandButton) expandButton.addEventListener('click', () => openLightbox(currentIndex));
            if (lightboxClose) lightboxClose.addEventListener('click', closeLightbox);
            if (lightboxPrev && images.length > 1) lightboxPrev.addEventListener('click', () => render(currentIndex - 1));
            if (lightboxNext && images.length > 1) lightboxNext.addEventListener('click', () => render(currentIndex + 1));
            if (lightbox) {{
                lightbox.addEventListener('click', event => {{
                    if (event.target === lightbox) closeLightbox();
                }});
            }}
            if (lightboxFullscreen) {{
                if (!document.fullscreenEnabled || !lightbox) {{
                    lightboxFullscreen.style.display = 'none';
                }} else {{
                    lightboxFullscreen.addEventListener('click', async () => {{
                        try {{
                            if (!document.fullscreenElement) {{
                                await lightbox.requestFullscreen();
                            }} else {{
                                await document.exitFullscreen();
                            }}
                        }} catch (error) {{
                            console.warn('Fullscreen unavailable', error);
                        }}
                    }});
                }}
            }}
            document.addEventListener('keydown', event => {{
                if (lightbox && lightbox.classList.contains('is-open')) {{
                    if (event.key === 'Escape') {{
                        closeLightbox();
                        return;
                    }}
                    if (images.length > 1 && event.key === 'ArrowLeft') render(currentIndex - 1);
                    if (images.length > 1 && event.key === 'ArrowRight') render(currentIndex + 1);
                }}
            }});

            render(0);
        }})();
    </script>
    """
    return render_public_page(
        title=page_title,
        description=page_description,
        canonical_path=f"/exempel/{canonical_slug}",
        content_html=content_html,
        og_image=image_urls[0],
    )


@app.route("/tillfalliga-produkter/<path:slug>", methods=["GET"])
def temp_product_page(slug: str):
    clean_slug = slug.strip().rstrip("/")
    if clean_slug.endswith(".html"):
        return redirect(f"/tillfalliga-produkter/{clean_slug[:-5]}", code=301)

    product, products = get_temp_product_by_slug(clean_slug)
    if not product:
        abort(404)

    canonical_slug = str(product.get("slug") or "").strip()
    if clean_slug != canonical_slug:
        return redirect(f"/tillfalliga-produkter/{canonical_slug}", code=301)

    title_text = str(product.get("title") or "Tillfällig produkt").strip()
    description_text = str(product.get("description") or "").strip()
    price_text = str(product.get("price") or "").strip()
    images = [absolute_public_url(img.get("url", "")) for img in product.get("images", []) if img.get("url")]
    image_urls = images or [absolute_public_url("/logo.png")]
    page_title = f"{title_text} - Tillfälliga produkter - Henricssons Båtkapell"
    page_description = product.get("share_description") or description_text[:160] or f"{title_text} hos Henricssons Båtkapell."
    contact_query = urlencode({"product": title_text, "product_slug": canonical_slug})
    contact_href = f"/kontakt?{contact_query}" if contact_query else "/kontakt"

    related_cards: List[str] = []
    for related in products:
        if related.get("slug") == canonical_slug:
            continue
        related_title = html.escape(str(related.get("title") or "Tillfällig produkt"))
        related_href = html.escape(str(related.get("href") or "/tillfalliga-produkter"))
        related_description = html.escape(str(related.get("share_description") or ""))
        related_price = html.escape(str(related.get("price") or ""))
        related_image = html.escape(absolute_public_url(str(related.get("primary_image_url") or "/logo.png")))
        related_cards.append(
            f"""
            <a class="seo-related-card" href="{related_href}">
                <img src="{related_image}" alt="{related_title}" loading="lazy" decoding="async">
                <div class="seo-related-copy">
                    <strong>{related_title}</strong>
                    {f'<span class="seo-related-price">{related_price}</span>' if related_price else ''}
                    <span>{related_description}</span>
                </div>
            </a>
            """
        )
        if len(related_cards) >= 3:
            break

    nav_style = "" if len(image_urls) > 1 else ' style="display:none;"'
    thumbs_html = "".join(
        f'<button type="button" class="seo-thumb{" is-active" if idx == 0 else ""}" data-index="{idx}"><img src="{html.escape(url)}" alt="{html.escape(title_text)} bild {idx + 1}" loading="lazy" decoding="async"></button>'
        for idx, url in enumerate(image_urls[:10])
    )
    gallery_html = f"""
    <div class="seo-gallery">
        <div class="seo-gallery-stage">
            <button type="button" class="seo-gallery-nav seo-gallery-prev" aria-label="Föregående bild"{nav_style}>&#8249;</button>
            <div class="seo-gallery-main">
                <img id="seoGalleryMainImage" src="{html.escape(image_urls[0])}" alt="{html.escape(title_text)}" loading="eager" decoding="async" fetchpriority="high">
            </div>
            <button type="button" class="seo-gallery-nav seo-gallery-next" aria-label="Nästa bild"{nav_style}>&#8250;</button>
        </div>
        {f'<div class="seo-thumbs">{thumbs_html}</div>' if len(image_urls) > 1 else ''}
    </div>
    """

    meta_html = f"""
    <div class="seo-meta">
        {f'<div class="seo-meta-block"><div class="seo-meta-label">Pris</div><p style="margin:0;">{html.escape(price_text)}</p></div>' if price_text else ''}
        <div class="seo-meta-block">
            <div class="seo-meta-label">Om produkten</div>
            <p style="margin:0;">{html.escape(description_text or 'Kontakta oss för mer information om denna produkt.')}</p>
        </div>
        <p class="seo-interest-text">Är du intresserad? Kontakta oss så återkommer vi.</p>
        <div class="seo-cta-row">
            <a class="seo-btn seo-btn-primary" href="{html.escape(contact_href)}">Kontakta oss</a>
            <a class="seo-btn" href="/tillfalliga-produkter">Till alla produkter</a>
        </div>
    </div>
    """

    content_html = f"""
    <main class="seo-page">
        <section class="seo-hero">
            <nav class="seo-breadcrumbs" aria-label="Brödsmulor">
                <a href="/">Hem</a>
                <span>/</span>
                <a href="/tillfalliga-produkter">Tillfälliga produkter</a>
                <span>/</span>
                <span>{html.escape(title_text)}</span>
            </nav>
            <span class="seo-kicker">Övriga produkter</span>
            <h1>{html.escape(title_text)}</h1>
        </section>
        <section class="seo-grid">
            <article class="seo-card">{gallery_html}</article>
            <aside class="seo-card">{meta_html}</aside>
        </section>
        <section class="seo-related">
            <h2>Fler tillfälliga produkter</h2>
            <div class="seo-related-grid">
                {''.join(related_cards) if related_cards else '<div class="seo-card"><p style="margin:0;">Fler produkter publiceras löpande.</p></div>'}
            </div>
        </section>
    </main>
    <script>
        (function () {{
            const images = {json.dumps(image_urls[:10])};
            if (images.length < 2) return;
            const mainImage = document.getElementById('seoGalleryMainImage');
            const thumbs = Array.from(document.querySelectorAll('.seo-thumb'));
            const prevButton = document.querySelector('.seo-gallery-prev');
            const nextButton = document.querySelector('.seo-gallery-next');
            let currentIndex = 0;

            function render(index) {{
                currentIndex = (index + images.length) % images.length;
                if (mainImage) mainImage.src = images[currentIndex];
                thumbs.forEach((thumb, i) => thumb.classList.toggle('is-active', i === currentIndex));
            }}

            thumbs.forEach((thumb, index) => thumb.addEventListener('click', () => render(index)));
            if (prevButton) prevButton.addEventListener('click', () => render(currentIndex - 1));
            if (nextButton) nextButton.addEventListener('click', () => render(currentIndex + 1));
        }})();
    </script>
    """
    return render_public_page(
        title=page_title,
        description=page_description,
        canonical_path=f"/tillfalliga-produkter/{canonical_slug}",
        content_html=content_html,
        og_image=image_urls[0],
    )


@app.route("/healthz", methods=["GET"])
def healthz():
    return jsonify(status="ok"), 200


@app.route("/admin", methods=["GET"])
@app.route("/admin.html", methods=["GET"])
def admin_page():
    if not check_admin_access():
        response = render_admin_login()
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        return response
    response = send_from_directory(str(BASE_DIR), "admin.html")
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    return response


@app.route("/admin/login", methods=["POST"])
def admin_login():
    password = request.form.get("password", "")
    if not validate_admin_password(password):
        return render_admin_login("Fel lösenord."), 403
    response = redirect("/admin", code=303)
    response.set_cookie(
        ADMIN_SESSION_COOKIE,
        sign_admin_session(int(time.time())),
        max_age=ADMIN_SESSION_MAX_AGE,
        httponly=True,
        secure=not is_local_request(),
        samesite="Lax",
    )
    return response


@app.route("/admin/logout", methods=["POST", "GET"])
def admin_logout():
    response = redirect("/admin", code=303)
    response.delete_cookie(ADMIN_SESSION_COOKIE)
    return response


@app.route("/", methods=["GET"])
def root():
    if (BASE_DIR / "index.html").exists():
        return send_from_directory(str(BASE_DIR), "index.html")
    return jsonify(status="ok")


@app.route("/chat_widget.js", methods=["GET"])
def chat_widget_script():
    if not is_public_chatbot_enabled():
        response = Response(CHAT_WIDGET_DISABLED_JS, content_type="application/javascript; charset=utf-8")
        response.headers["Cache-Control"] = "no-store, max-age=0"
        return response
    response = send_from_directory(str(BASE_DIR), "chat_widget.js")
    response.headers["Cache-Control"] = "public, max-age=300"
    return response


@app.route("/<path:filename>", methods=["GET"])
def serve_static(filename: str):
    if filename.startswith("api/"):
        abort(404)

    clean_name = filename.rstrip("/")
    if not clean_name:
        return redirect("/", code=301)

    admin_html_path = (BASE_DIR / "admin.html").resolve()
    requested_file_path = (BASE_DIR / clean_name).resolve()
    requested_html_path = (BASE_DIR / f"{clean_name}.html").resolve()
    if requested_file_path == admin_html_path or requested_html_path == admin_html_path:
        return admin_page()

    # Keep legacy .html links working but canonicalize to extensionless URLs.
    if clean_name.endswith(".html"):
        page_slug = clean_name[:-5]
        if BASE_DIR in requested_file_path.parents and requested_file_path.exists() and requested_file_path.is_file():
            if page_slug == "index":
                return redirect("/", code=301)
            return redirect(f"/{page_slug}", code=301)

    if clean_name == "chat_widget.js" and not is_public_chatbot_enabled():
        response = Response(CHAT_WIDGET_DISABLED_JS, content_type="application/javascript; charset=utf-8")
        response.headers["Cache-Control"] = "no-store, max-age=0"
        return response

    target = requested_file_path
    if BASE_DIR in target.parents and target.exists() and target.is_file():
        return send_from_directory(str(target.parent), target.name)

    html_target = requested_html_path
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

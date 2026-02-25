from __future__ import annotations

import base64
import ipaddress
import json
import os
import re
from datetime import datetime
from functools import wraps
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests
from flask import Flask, abort, jsonify, request, send_from_directory
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

DEFAULT_DATABASE_URL = f"sqlite:///{(BASE_DIR / 'henricssons.db').as_posix()}"
DATABASE_URL = os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL)
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-5-mini")
CHAT_MODEL = os.getenv("CHAT_MODEL", "gpt-5-mini").strip() or "gpt-5-mini"
OPENAI_REASONING_EFFORT = os.getenv("OPENAI_REASONING_EFFORT", "minimal").strip().lower() or "minimal"
ADMIN_API_KEY = os.getenv("ADMIN_API_KEY", "").strip()

DEFAULT_ALLOWED_ORIGINS = ",".join(
    [
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
        if isinstance(self.fields, dict):
            submitted_via = str(self.fields.get("__submitted_via", "web_form"))
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
        "Du svarar på kapellförfrågningar för Henricssons Båtkapell. "
        "Svara kort, professionellt och affärsdrivande. "
        "Bekräfta kundens båt/kapellbehov och be om de viktigaste saknade detaljerna för offert/måttagning. "
        "Fråga bara relevanta följdfrågor som tar ärendet till nästa steg."
    ),
    "Fenderforfragan": (
        "Du svarar på förfrågningar om fenderstrumpor. "
        "Svara kort, tydligt och affärsdrivande på svenska. "
        "Bekräfta antal/storlek och be om endast relevanta saknade uppgifter för att kunna lägga offert/order."
    ),
    "Kontakt": (
        "Du svarar på allmänna kontaktförfrågningar. "
        "Svara kort, hjälpsamt och professionellt på svenska. "
        "Identifiera syftet snabbt och ställ endast relevanta följdfrågor som gör att vi kan återkomma med tydligt nästa steg."
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
Du låter som en riktig människa i receptionen: varm, tydlig, kort och professionell.

Övergripande beteende:
- Svara naturligt på kundens faktiska fråga först.
- Variera formuleringar mellan svar. Undvik mallspråk och upprepade standardfraser.
- Om kunden bara hälsar eller småpratar: hälsa tillbaka och fråga öppet vad kunden vill ha hjälp med.
- Vid hälsning/småprat: be inte om personuppgifter och be inte om formulärfält.

Formtyper (visningsnamn -> intent):
- Kapellförfrågan -> Kapellforfragan
- Fenderförfrågan -> Fenderforfragan
- Kontakt -> Kontakt

Fältspecifikation:
- Kapellförfrågan (intent: Kapellforfragan)
  required: name, phone, email, manufacturer, model, boat_year, home_port
  optional: old_canopy, message
- Fenderförfrågan (intent: Fenderforfragan)
  required: name, phone, email, quantity, size
  optional: address
- Kontakt (intent: Kontakt)
  required: name, email, subject, message
  optional: phone

När uppgifter ska samlas in:
- Samla in formulärfält bara när kunden tydligt vill göra en förfrågan eller skicka ett meddelande.
- Om kunden ställer allmänna frågor: svara tydligt direkt i chatten så långt du kan.
- Föreslå kontaktformulär bara när kunden själv vill bli kontaktad eller när frågan kräver uppföljning utanför chatten.
- Välj intent utifrån kundens mål, inte enstaka ord.
- Om kunden vill ha kapell: använd Kapellforfragan även om båtmodell/tillverkare råkar innehålla ord som "Fender".
- Om kunden vill ha fenderstrumpor/fenderskydd: använd Fenderforfragan.
- För Fenderforfragan: be aldrig om fria mått eller storlekstyper som "small/medium/large". Be kunden välja storlek i chatten via storleks-dropdown.
- Fråga bara efter fält som finns i listan ovan.
- Fråga i första hand efter saknade required-fält.
- Fråga inte aktivt efter optional-fält; spara dem om kunden själv nämner dem.
- När du ber om uppgifter: fråga flera saknade required-fält i samma svar (normalt 2-4), inte en fråga i taget när flera fält saknas.
- För Kontakt: skapa ett tydligt och specifikt ämne som passar meddelandets innehåll. Undvik generiska ämnen som "Kontaktförfrågan" om mer specifik rubrik går att skriva.
- För Kontakt: när draft.message sätts, renskriv kundens text till korrekt och professionell svenska/engelska, men behåll exakt innebörd, fakta, namn, siffror och önskemål.

Stilregler:
- Svara på samma språk som kunden använder. Om oklart: svenska.
- Håll svar korta, 1-3 meningar.
- Inga metakommentarer eller robotfraser.
- Uppfinn aldrig uppgifter.
- HÅRD REGEL: använd aldrig em dash (—) eller en dash (–) i synlig chattext.
- Om du annars hade använt långt streck: skriv i stället vanligt bindestreck (-), kolon (:) eller punkt (.).
- Använd inte fasta fraser som "Jag behöver följande information" i varje svar.

Outputprotokoll:
- Skriv ALLTID synlig chattext till kunden (vanlig text eller markdown).
- Skriv ALDRIG ren JSON i den synliga chattexten.
- Om ingen state-uppdatering behövs: skriv ingen kommandodel.
- Om state ska uppdateras: lägg sist i svaret ett dolt kommandoblock exakt så här:
  [[CMD]]{...giltig JSON...}[[/CMD]]
- JSON i kommandoblocket får ENDAST innehålla nycklarna:
  intent, draft, missing_fields, needs_confirmation, ready_to_submit, summary

Regler för kommandot:
- Sätt intent först när du gör första sammanfattningen i kommandoblocket.
- intent ska då vara exakt "Kapellforfragan" eller "Fenderforfragan" eller "Kontakt".
- ready_to_submit = true först när du har gjort en slutlig sammanfattning och allt som krävs finns.
- needs_confirmation = false tills alla required-fält finns; sätt needs_confirmation = true först när ready_to_submit = true.
- Intent, draft och summary ska komma från din egen förståelse av hela konversationen (history + aktuellt meddelande), inte från någon backend-extraktion.
- I kommandots draft använder du interna nycklar (name, phone, email, manufacturer, model, osv).
- För intent Kontakt: sätt draft.subject till en kort, specifik ämnesrad (ca 3-8 ord) baserat på kundens ärende.
- För intent Kontakt: sätt draft.message till en renskriven version av kundens meddelande med samma innehåll.
- Sätt summary till tom sträng ("") tills alla required-fält finns.
- Sätt summary först i slutläget när ready_to_submit = true.
- När du inkluderar kommandoblock med sammanfattning eller ready_to_submit=true: avsluta alltid synlig chattext med en kort bekräftelsefråga, t.ex. "Stämmer detta?".
- I synlig chattext använder du mänskliga fältnamn på svenska.
- Lägg sammanfattningen i command.summary när state uppdateras, inte som lång blocktext i synlig chat.
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
            }
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
        f"- Optional hidden command block markers are exactly: {ASSISTANT_COMMAND_START} and {ASSISTANT_COMMAND_END}.\n"
        "- If command block is present, JSON inside must use keys only: intent, draft, missing_fields, needs_confirmation, ready_to_submit, summary.\n"
        "- You are the source of truth for intent, draft and summary based on the full conversation context.\n"
        "- The backend does not infer intent or extract fields from raw customer text.\n"
        "- Re-evaluate intent on every user message and current state.\n"
        "- Answer customer questions directly in chat whenever possible; do not default to asking for contact form.\n"
        "- For Fenderforfragan size: do not ask for free-text measurements or S/M/L style sizes. Ask user to choose size in the chat dropdown.\n"
        "- When required fields are missing, ask for multiple missing required fields in the same reply (normally 2-4), not one at a time.\n"
        "- Never put the full field summary in visible chat text; keep it in command.summary only.\n"
        "- Keep summary as empty string until all required fields are present.\n"
        "- As soon as all required fields for selected intent are present, set ready_to_submit=true, needs_confirmation=true and include summary.\n"
        "- For Kapellforfragan, boat_year and home_port are required.\n"
        "- For Kontakt intent: set draft.subject to a short specific subject inferred from the message. Avoid generic subject lines when a specific one is possible.\n"
        "- For Kontakt intent: set draft.message to a cleaned, professional rewrite of the user's message in the same language, preserving meaning and facts.\n"
        "- If command block includes summary or ready_to_submit=true, end visible text with a short confirmation question (example in Swedish: 'Stämmer detta?').\n"
        "- If you do not need to update state, do not include any command block."
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

    command_data = model_command if isinstance(model_command, dict) else {}
    model_intent = normalize_intent(str(command_data.get("intent", "")))
    base_intent = payload_intent if payload_intent in VALID_INTENTS else ""
    intent = model_intent if model_intent in VALID_INTENTS else base_intent

    parsed_draft: Dict[str, str] = {}
    raw_model_draft = command_data.get("draft", {})
    if isinstance(raw_model_draft, dict):
        for key, value in raw_model_draft.items():
            key_str = canonicalize_draft_key(str(key))
            if not key_str:
                continue
            parsed_draft[key_str] = str(value or "").strip()[:1000]

    merged_source = dict(draft)
    merged_source.update(parsed_draft)
    if intent not in VALID_INTENTS:
        inferred_from_draft = detect_intent_from_draft(merged_source)
        intent = inferred_from_draft if inferred_from_draft in VALID_INTENTS else "Kontakt"
    merged_draft = normalize_draft(intent, merged_source)

    missing_fields = compute_missing_fields(intent, merged_draft)
    model_ready = bool(command_data.get("ready_to_submit", False))
    ready_to_submit = bool(intent in VALID_INTENTS and model_ready and not missing_fields)
    needs_confirmation = bool(command_data.get("needs_confirmation", ready_to_submit)) if ready_to_submit else False
    confirmed = explicit_confirmation and ready_to_submit
    summary = str(command_data.get("summary", "") or "").strip()
    summary = sanitize_visible_reply_text(summary)
    submit_command: Optional[Dict[str, Any]] = None
    if ready_to_submit:
        cmd_form_type, cmd_fields = map_draft_to_submission(intent, merged_draft)
        submit_command = {
            "action": "assistant_submit",
            "form_type": cmd_form_type,
            "fields": cmd_fields,
            "payload": {
                "intent": intent,
                "draft": merged_draft,
                "confirmed": True,
            },
        }
    reply = str(reply or "").strip()
    if not reply:
        return jsonify(error="AI returned empty visible reply"), 502
    response_language = requested_language
    if ready_to_submit and summary:
        reply = ensure_confirmation_question(reply, response_language)
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
    target = (BASE_DIR / filename).resolve()
    if BASE_DIR not in target.parents:
        abort(404)
    if target.exists() and target.is_file():
        return send_from_directory(str(target.parent), target.name)
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


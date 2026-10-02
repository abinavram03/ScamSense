# pyrefly: ignore [missing-import]
from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")
os.environ.setdefault("NUMEXPR_NUM_THREADS", "1")

import asyncio
import io
import csv
import re
import logging
import threading
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta
from typing import Optional

import bcrypt
import cv2
import jwt
import numpy as np
import pytesseract
from bson import ObjectId
from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends, UploadFile, File
from fastapi.responses import StreamingResponse
from motor.motor_asyncio import AsyncIOMotorClient
from PIL import Image, ImageOps
from pydantic import BaseModel, EmailStr, Field
from starlette.middleware.cors import CORSMiddleware

import predictor as predictor_mod
from predictor import predictor
import reputation as reputation_mod

# ---------- Config ----------
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_MIN = 60 * 24  # 1 day (single-page prototype)
JWT_SECRET = os.environ["JWT_SECRET"]

# Tesseract path for Windows
_TESSERACT_PATH = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
if os.path.exists(_TESSERACT_PATH):
    pytesseract.pytesseract.tesseract_cmd = _TESSERACT_PATH


# ---------- DB ----------
mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
db_name = os.environ.get("DB_NAME", "test_database")
client: AsyncIOMotorClient = None  # type: ignore[assignment]
db = None  # type: ignore[assignment]

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("scamsense")

# ---------- Password / JWT helpers ----------
def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def verify_password(pw: str, hashed: str) -> bool:
    return bcrypt.checkpw(pw.encode(), hashed.encode())


def create_access_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "type": "access",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_MIN),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token")
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        # Copy first: some drivers hand back a live reference, so converting
        # _id in place would corrupt the stored document and mis-attribute
        # later requests to the wrong account.
        user = dict(user)
        user["_id"] = str(user["_id"])
        user.pop("password_hash", None)
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


def _set_auth_cookie(response: Response, token: str) -> None:
    is_prod = os.environ.get("ENV", "development") == "production"
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        secure=is_prod,
        samesite="none" if is_prod else "lax",
        max_age=ACCESS_TOKEN_MIN * 60,
        path="/",
    )


# ---------- Startup ----------
async def seed_admin():
    admin_email = os.environ.get("ADMIN_EMAIL", "scamsense@admin.com").lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "SS012")
    existing = await db.users.find_one({"email": admin_email})
    if not existing:
        await db.users.insert_one({
            "email": admin_email,
            "password_hash": hash_password(admin_password),
            "name": "Admin",
            "role": "admin",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        logger.info("Seeded admin: %s", admin_email)
    elif not verify_password(admin_password, existing["password_hash"]):
        await db.users.update_one(
            {"email": admin_email},
            {"$set": {"password_hash": hash_password(admin_password)}},
        )
        logger.info("Refreshed admin password: %s", admin_email)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global client, db
    client = AsyncIOMotorClient(mongo_url, serverSelectionTimeoutMS=2000)
    db = client[db_name]

    try:
        await client.admin.command("ping")
        logger.info("Connected to MongoDB at %s", mongo_url)
    except Exception as err:
        logger.warning("MongoDB connection failed (%s). Falling back to in-memory MongoDB mock.", err)
        from mongomock_motor import AsyncMongoMockClient
        client = AsyncMongoMockClient()
        db = client[db_name]

    try:
        await db.users.create_index("email", unique=True)
        await db.scans.create_index([("user_id", 1), ("created_at", -1)])
    except Exception as idx_err:
        logger.warning("Index creation notice: %s", idx_err)

    await seed_admin()
    predictor.ensure_ready()

    yield

    client.close()


# ---------- App ----------
app = FastAPI(title="ScamSense", lifespan=lifespan)
api = APIRouter(prefix="/api")


# ---------- Models ----------
class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)
    name: Optional[str] = None


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class PredictIn(BaseModel):
    url: str = Field(default="", max_length=2048)
    message: str = Field(default="", max_length=5000)


class UserOut(BaseModel):
    id: str
    email: str
    name: Optional[str] = None


# ---------- Auth routes ----------
@api.post("/auth/register")
async def register(payload: RegisterIn, response: Response):
    email = payload.email.lower()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")
    doc = {
        "email": email,
        "password_hash": hash_password(payload.password),
        "name": payload.name or email.split("@")[0],
        "role": "user",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    res = await db.users.insert_one(doc)
    uid = str(res.inserted_id)
    token = create_access_token(uid, email)
    _set_auth_cookie(response, token)
    return {"id": uid, "email": email, "name": doc["name"], "token": token}


@api.post("/auth/login")
async def login(payload: LoginIn, response: Response):
    email = payload.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    uid = str(user["_id"])
    token = create_access_token(uid, email)
    _set_auth_cookie(response, token)
    return {"id": uid, "email": email, "name": user.get("name"), "token": token}


@api.post("/auth/logout")
async def logout(response: Response, _user: dict = Depends(get_current_user)):
    response.delete_cookie("access_token", path="/")
    return {"ok": True}


@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return {"id": user["_id"], "email": user["email"], "name": user.get("name")}


# ---------- Translation ----------
# Unicode script ranges let us identify the language offline and with no
# third-party call, so detection still works with no network and is instant.
_SCRIPT_RANGES = [
    ("Devanagari", 0x0900, 0x097F, "hi"),   # Hindi / Marathi
    ("Bengali", 0x0980, 0x09FF, "bn"),
    ("Gurmukhi", 0x0A00, 0x0A7F, "pa"),
    ("Gujarati", 0x0A80, 0x0AFF, "gu"),
    ("Oriya", 0x0B00, 0x0B7F, "or"),
    ("Tamil", 0x0B80, 0x0BFF, "ta"),
    ("Telugu", 0x0C00, 0x0C7F, "te"),
    ("Kannada", 0x0C80, 0x0CFF, "kn"),
    ("Malayalam", 0x0D00, 0x0D7F, "ml"),
    ("Sinhala", 0x0D80, 0x0DFF, "si"),
    ("Arabic", 0x0600, 0x06FF, "ar"),
    ("Cyrillic", 0x0400, 0x04FF, "ru"),
    ("Greek", 0x0370, 0x03FF, "el"),
    ("Hebrew", 0x0590, 0x05FF, "he"),
    ("Thai", 0x0E00, 0x0E7F, "th"),
]

# Shown in the picker, ordered by likely relevance for this project's users.
SUPPORTED_LANGUAGES = [
    {"code": "en", "name": "English", "native": "English"},
    {"code": "hi", "name": "Hindi", "native": "हिन्दी"},
    {"code": "ta", "name": "Tamil", "native": "தமிழ்"},
    {"code": "te", "name": "Telugu", "native": "తెలుగు"},
    {"code": "kn", "name": "Kannada", "native": "ಕನ್ನಡ"},
    {"code": "ml", "name": "Malayalam", "native": "മലയാളം"},
    {"code": "bn", "name": "Bengali", "native": "বাংলা"},
    {"code": "gu", "name": "Gujarati", "native": "ગુજરાતી"},
    {"code": "mr", "name": "Marathi", "native": "मराठी"},
    {"code": "pa", "name": "Punjabi", "native": "ਪੰਜਾਬੀ"},
    {"code": "or", "name": "Odia", "native": "ଓଡ଼ିଆ"},
    {"code": "ar", "name": "Arabic", "native": "العربية"},
    {"code": "ru", "name": "Russian", "native": "Русский"},
    {"code": "es", "name": "Spanish", "native": "Español"},
    {"code": "fr", "name": "French", "native": "Français"},
    {"code": "de", "name": "German", "native": "Deutsch"},
    {"code": "zh-CN", "name": "Chinese (Simplified)", "native": "中文"},
    {"code": "ja", "name": "Japanese", "native": "日本語"},
    {"code": "ko", "name": "Korean", "native": "한국어"},
]

_LANG_NAMES = {l["code"]: l for l in SUPPORTED_LANGUAGES}

# (source, target, text) -> translated text. The explanation strings come from a
# fixed set of templates, so this keeps repeat scans from burning the free
# MyMemory quota.
_TRANSLATION_CACHE: dict[tuple[str, str, str], str] = {}

# MyMemory rejects any query longer than this with responseStatus 403 and
# "QUERY LENGTH LIMIT EXCEEDED". Longer messages must be split.
_MYMEMORY_MAX_CHARS = 500

# Set when MyMemory tells us the free daily allowance is gone, so the user gets
# "try tomorrow" instead of a generic outage message.
_quota_exhausted = threading.Event()


def _quota_hint() -> str:
    return (
        "The free translation quota for today is used up. Translations reset in a few "
        "hours. The scan and its verdict are unaffected."
    )


def _is_quota_message(text: str) -> bool:
    t = (text or "").upper()
    return "MYMEMORY WARNING" in t or "USED ALL AVAILABLE FREE TRANSLATIONS" in t


def detect_language(text: str) -> str:
    """Return an ISO code for the dominant script in `text`.

    Falls back to English, which is the only language the message model was
    trained on, so callers can treat the code as "what the model expects".
    """
    counts: dict[str, int] = {}
    for ch in text or "":
        cp = ord(ch)
        for _name, lo, hi, code in _SCRIPT_RANGES:
            if lo <= cp <= hi:
                counts[code] = counts.get(code, 0) + 1
                break
    if not counts:
        return "en"
    return max(counts.items(), key=lambda kv: kv[1])[0]


def _language_name(code: str) -> str:
    entry = _LANG_NAMES.get(code)
    if entry:
        return f"{entry['name']} ({entry['native']})"
    return code


class TranslateIn(BaseModel):
    text: str = Field(min_length=1)
    # No pattern constraint here: an unsupported code must produce the
    # explanatory 400 below, not a generic 422 validation blob.
    target: str
    source: str | None = None
    # Optional explanation strings. The UI sends the English verdict, its
    # reasons and the recommendation so the reader gets the *whole* result in
    # their language, not just the message body.
    verdict: str | None = None
    reasons: list[str] = Field(default_factory=list)
    recommendation: str | None = None


@api.get("/languages")
async def list_languages():
    return {"languages": SUPPORTED_LANGUAGES}


@api.post("/translate")
async def translate_text(payload: TranslateIn, user: dict = Depends(get_current_user)):
    """Translate a scanned message and its explanation for the reader.

    This runs after classification and only affects what the user reads. The
    English verdict above is always the model's own output and is never
    replaced by a translation, because a mistranslated safety label on a
    phishing detector is worse than an English one.
    """
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Nothing to translate.")

    source = (payload.source or "").strip() or detect_language(text)
    target = payload.target.strip()

    if target not in _LANG_NAMES:
        raise HTTPException(status_code=400, detail=f"Unsupported target language: {target}")

    common = {
        "source_language": source,
        "source_language_name": _language_name(source),
        "target_language": target,
        "target_language_name": _language_name(target),
    }

    # Nothing to do if it is already in the requested language.
    if source == target:
        return {
            **common,
            "translated_text": text,
            "translated_verdict": payload.verdict,
            "translated_reasons": list(payload.reasons),
            "translated_recommendation": payload.recommendation,
            "explanation_translated": False,
            "skipped": True,
            "note": "Message is already in the selected language.",
        }

    loop = asyncio.get_event_loop()

    # The body and every explanation string go out together, so the whole
    # result still costs a single round trip.
    jobs = [text] + [r for r in payload.reasons if r.strip()]
    if (payload.verdict or "").strip():
        jobs.append(payload.verdict)
    if (payload.recommendation or "").strip():
        jobs.append(payload.recommendation)

    results = await asyncio.gather(
        *(loop.run_in_executor(None, _translate_safe, s, source, target) for s in jobs)
    )

    # A failed explanation translation degrades to the English original; it must
    # never fail the request, because the message translation is what matters.
    # The body itself is different: if it failed there is nothing useful to
    # show, so fail loudly rather than present English as a "translation".
    if results[0] is None:
        raise HTTPException(
            status_code=503,
            detail=_quota_hint() if _quota_exhausted.is_set()
            else "Translation service unavailable. The verdict above is unaffected.",
        )

    out: list[str] = [results[0]] + [
        value if value else original
        for original, value in zip(jobs[1:], results[1:])
    ]

    reason_count = len([r for r in payload.reasons if r.strip()])
    translated_reasons = out[1 : 1 + reason_count]
    cursor = 1 + reason_count
    translated_verdict = out[cursor] if (payload.verdict or "").strip() else None
    cursor += 1 if (payload.verdict or "").strip() else 0
    translated_recommendation = out[cursor] if (payload.recommendation or "").strip() else None

    return {
        **common,
        "translated_text": out[0],
        "translated_verdict": translated_verdict,
        "translated_reasons": translated_reasons,
        "translated_recommendation": translated_recommendation,
        "explanation_translated": any(
            v and v != o for v, o in zip(out, jobs)
        ),
        "skipped": False,
        "note": "Machine translation can be inaccurate. Trust the verdict, not the translation.",
    }


def _translate_safe(text: str, source: str, target: str) -> str | None:
    """Translate one string, returning None on failure so callers can fall
    back to the English original."""
    try:
        return _translate_with_mymemory(text, source, target)
    except Exception:
        return None


def _chunk_text(text: str, limit: int = _MYMEMORY_MAX_CHARS) -> list[str]:
    """Split text into pieces MyMemory will accept.

    MyMemory's free endpoint rejects any query over 500 characters, returning
    HTTP 200 with responseStatus 403 and "QUERY LENGTH LIMIT EXCEEDED". The
    limit is on the character count of the request, so split on sentence
    boundaries where possible and fall back to words.
    """
    text = text.strip()
    if len(text) <= limit:
        return [text] if text else []

    # Leave headroom: chunking on punctuation can overshoot the limit by the
    # length of the delimiter we re-add afterwards.
    budget = limit - 40
    chunks: list[str] = []
    current = ""

    for sentence in re.split(r"(?<=[.!?\u0964\u0965])\s+|\n+", text):
        sentence = sentence.strip()
        if not sentence:
            continue
        if len(sentence) > limit:
            # A single monster "sentence": split it on words.
            for word in sentence.split():
                # One word can be longer than the whole budget (a long URL or a
                # base64 blob), and it must be cut or it overflows the limit.
                while len(word) > budget:
                    if current:
                        chunks.append(current)
                        current = ""
                    chunks.append(word[:budget])
                    word = word[budget:]
                if not word:
                    continue
                if len(current) + len(word) + 1 > budget:
                    if current:
                        chunks.append(current)
                    current = word
                else:
                    current = f"{current} {word}".strip()
            continue
        if len(current) + len(sentence) + 1 > budget:
            if current:
                chunks.append(current)
            current = sentence
        else:
            current = f"{current} {sentence}".strip()

    if current:
        chunks.append(current)
    return chunks


def _translate_with_mymemory(text: str, source: str, target: str) -> str:
    """Translate text into `target` using MyMemory's public API (no key needed).

    Long text is translated in chunks because of the API's 500-character limit.
    Runs in a worker thread so a slow or unreachable third party cannot block
    the event loop. Results are cached because the explanation strings are
    fixed templates, so consecutive scans ask for the same strings repeatedly.
    """
    import requests

    chunks = _chunk_text(text)
    if not chunks:
        raise RuntimeError("nothing to translate")

    # Chunks are translated in order rather than concurrently: a long message
    # is at most ten requests, and firing them all at once is what trips
    # MyMemory's rate limiting. Cached chunks make repeat scans free.
    pieces = [_translate_chunk(c, source, target) for c in chunks]
    return " ".join(p for p in pieces if p)


def _translate_chunk(text: str, source: str, target: str) -> str:
    """One MyMemory round trip for a chunk that is known to fit the limit."""
    import requests

    key = (source, target, text.strip())
    cached = _TRANSLATION_CACHE.get(key)
    if cached:
        return cached

    # Anonymous use is capped at a few thousand words a day per IP. Setting
    # MYMEMORY_API_KEY (or MYMEMORY_EMAIL) lifts that, so the picker keeps
    # working for anyone who runs this more than a few times a day.
    params = {"q": text, "langpair": f"{source}|{target}"}
    if os.environ.get("MYMEMORY_API_KEY"):
        params["key"] = os.environ["MYMEMORY_API_KEY"]
    elif os.environ.get("MYMEMORY_EMAIL"):
        params["de"] = os.environ["MYMEMORY_EMAIL"]

    resp = requests.get(
        "https://api.mymemory.translated.net/get",
        params=params,
        timeout=12,
        headers={"User-Agent": "ScamSense/1.0 (educational phishing detector)"},
    )

    # Parse the body before deciding it failed: MyMemory signals a spent quota
    # with a real HTTP 429, and quota exhaustion deserves its own message.
    try:
        data = resp.json()
    except ValueError:
        resp.raise_for_status()
        raise RuntimeError("translation returned a non-JSON response")

    http_status = resp.status_code
    status = str(data.get("responseStatus") or http_status or "200")
    if http_status != 200 or status != "200":
        if http_status == 429 or status == "429":
            _quota_exhausted.set()
        raise RuntimeError(f"translation refused: http={http_status} status={status}")
    out = (data.get("responseData") or {}).get("translatedText") or ""
    if not out.strip():
        raise RuntimeError("translation unavailable")
    # The quota warning comes back in the text field with a 200 status on some
    # calls. It must never reach the user rendered as a translation.
    if _is_quota_message(out):
        _quota_exhausted.set()
        raise RuntimeError("translation quota exhausted")
    # The API echoes the input back when it cannot translate. Short chunks are
    # often genuinely identical (a bare "OTP" or a product name), so only treat
    # a substantial unchanged chunk as a failure.
    if len(text.strip()) > 40 and out.strip() == text.strip():
        raise RuntimeError("translation unavailable")

    if len(_TRANSLATION_CACHE) > 500:
        _TRANSLATION_CACHE.clear()
    _TRANSLATION_CACHE[key] = out
    return out


# ---------- Predict ----------
async def _predict_with_reputation(url: str, message: str) -> dict:
    """Score with the ML models, then layer domain reputation on top.

    The two run concurrently so a slow reputation source does not add to the
    time the models take. Reputation failing is never fatal: the result is then
    exactly the old ML-only payload.
    """
    loop = asyncio.get_event_loop()

    async def _rep() -> dict:
        if not (url or "").strip():
            return {}
        try:
            result = await loop.run_in_executor(None, reputation_mod.analyse, url)
            return result.as_dict()
        except Exception:
            return {"available": False, "notes": ["Reputation lookup failed."]}

    model_job = loop.run_in_executor(None, predictor.predict, url, message, None)
    rep_job = _rep()
    model_result, rep_result = await asyncio.gather(model_job, rep_job)
    # Arithmetic only -- no model work, so SHAP is not paid for twice.
    return await loop.run_in_executor(
        None, predictor.apply_reputation, model_result, rep_result
    )


@api.post("/predict")
async def predict(payload: PredictIn, user: dict = Depends(get_current_user)):
    if not (payload.url or "").strip() and not (payload.message or "").strip():
        raise HTTPException(status_code=400, detail="Provide at least a URL or a message.")
    loop = asyncio.get_event_loop()

    # The Message/Email tabs submit only `message`, so a link pasted into a
    # message never reached the URL model and a known phishing domain scored
    # Safe. Extract it here so the URL features apply to every input path.
    url = (payload.url or "").strip()
    message = payload.message or ""
    urls_found = _unique(_URL_RE.findall(message))
    if not url and urls_found:
        url = urls_found[0]

    result = await _predict_with_reputation(url, message)
    doc = {
        "user_id": user["_id"],
        "url": url,
        "message": message,
        "risk_score": result["risk_score"],
        "verdict": result["verdict"],
        "url_reasons": result["url_reasons"],
        "message_reasons": result["message_reasons"],
        "recommendation": result["recommendation"],
        "ml_risk_score": result.get("ml_risk_score"),
        "reputation_bump": result.get("reputation_bump", 0.0),
        "reputation_signals": [s.get("label") for s in (result.get("reputation", {}).get("signals") or [])],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.scans.insert_one(doc)
    result["scanned_url"] = url
    result["urls_found"] = urls_found[:10]
    result["message_preview"] = message[:200]
    # The preview above is for display only; the translator needs the whole
    # message, otherwise a translation silently stops at 200 characters.
    result["message_content"] = message
    result["detected_language"] = detect_language(message)
    result["url_from_message"] = bool(urls_found and not (payload.url or "").strip())
    return result


@api.get("/scans")
async def list_scans(user: dict = Depends(get_current_user), limit: int = 20):
    projection = {"_id": 1, "url": 1, "message": 1, "risk_score": 1, "verdict": 1, "created_at": 1}
    cur = db.scans.find({"user_id": user["_id"]}, projection).sort("created_at", -1).limit(limit)
    out = []
    async for d in cur:
        out.append({
            "id": str(d["_id"]),
            "url": d.get("url", ""),
            "message": d.get("message", ""),
            "risk_score": d.get("risk_score"),
            "verdict": d.get("verdict"),
            "created_at": d.get("created_at"),
        })
    return out


@api.get("/health")
async def health():
    return {"status": "ok", "model_ready": predictor._loaded}


# ---------- Scan stats ----------
@api.get("/stats")
async def scan_stats(user: dict = Depends(get_current_user)):
    uid = user["_id"]
    total = await db.scans.count_documents({"user_id": uid})
    phishing = await db.scans.count_documents({"user_id": uid, "verdict": "Phishing"})
    suspicious = await db.scans.count_documents({"user_id": uid, "verdict": "Suspicious"})
    safe = await db.scans.count_documents({"user_id": uid, "verdict": "Safe"})

    pipeline = [
        {"$match": {"user_id": uid}},
        {"$group": {"_id": None, "avg_risk": {"$avg": "$risk_score"}}},
    ]
    avg_risk = 0.0
    async for doc in db.scans.aggregate(pipeline):
        avg_risk = doc.get("avg_risk", 0.0)

    last_scan = await db.scans.find_one(
        {"user_id": uid}, sort=[("created_at", -1)]
    )

    return {
        "total": total,
        "phishing": phishing,
        "suspicious": suspicious,
        "safe": safe,
        "avg_risk_score": round(avg_risk, 4),
        "last_scan_at": last_scan.get("created_at") if last_scan else None,
    }


# ---------- Individual scan ----------
@api.get("/scans/{scan_id}")
async def get_scan(scan_id: str, user: dict = Depends(get_current_user)):
    try:
        doc = await db.scans.find_one({"_id": ObjectId(scan_id), "user_id": user["_id"]})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid scan ID")
    if not doc:
        raise HTTPException(status_code=404, detail="Scan not found")
    return {
        "id": str(doc["_id"]),
        "url": doc.get("url", ""),
        "message": doc.get("message", ""),
        "risk_score": doc.get("risk_score"),
        "verdict": doc.get("verdict"),
        "url_reasons": doc.get("url_reasons", []),
        "message_reasons": doc.get("message_reasons", []),
        "recommendation": doc.get("recommendation", ""),
        "created_at": doc.get("created_at"),
    }


@api.delete("/scans/{scan_id}")
async def delete_scan(scan_id: str, user: dict = Depends(get_current_user)):
    try:
        result = await db.scans.delete_one({"_id": ObjectId(scan_id), "user_id": user["_id"]})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid scan ID")
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Scan not found")
    return {"ok": True}


@api.delete("/scans")
async def clear_scans(user: dict = Depends(get_current_user)):
    result = await db.scans.delete_many({"user_id": user["_id"]})
    return {"ok": True, "deleted": result.deleted_count}


# ---------- Quick URL check (public, no auth) ----------
class QuickCheckIn(BaseModel):
    url: str = Field(min_length=1)


@api.post("/scan-url")
async def quick_url_check(payload: QuickCheckIn):
    url = payload.url.strip()
    result = await _predict_with_reputation(url, "")
    return {
        "url": url,
        "risk_score": result["risk_score"],
        "verdict": result["verdict"],
        "url_reasons": result["url_reasons"],
        "recommendation": result["recommendation"],
    }


# ---------- Scan image (OCR) ----------
_URL_RE = re.compile(r"https?://[^\s<>\"']+|www\.[^\s<>\"']+")
_EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")


def _unique(seq):
    """Order-preserving de-duplication.

    ``list(set(...))`` must not be used here: string hashing is randomised per
    process (PYTHONHASHSEED), so the "first" URL picked from a scan could differ
    between runs and change the risk score for identical input.
    """
    seen, out = set(), []
    for item in seq:
        if item not in seen:
            seen.add(item)
            out.append(item)
    return out


# ---------- QR decoding ----------
_QR_ALLOWED_TYPES = {"image/png", "image/jpeg", "image/jpg", "image/webp", "image/bmp", "image/tiff"}
_MAX_QR_BYTES = 8_000_000
# Bare hostnames such as "paypal-secure.tk" are common inside QR payloads.
_BARE_HOST_RE = re.compile(
    r"^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?:/[^\s]*)?$", re.IGNORECASE
)


def _qr_variants(rgb: np.ndarray):
    """Yield progressively heavier pre-processings of the image.

    A screenshot QR decodes on the first try, but real uploads rarely arrive
    that cleanly: photos re-compressed by messaging apps, codes on coloured
    backgrounds, and low-contrast prints all defeat the raw detector. Each
    variant is tried in increasing cost order and decoding stops at the first
    hit, so the common case stays cheap.

    OpenCV needs each QR module to span several pixels, which is not true for a
    code photographed off a phone screen, hence the upscaling retries. Upscaling
    is skipped once it would exceed a sane pixel budget.
    """
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)

    # Cheap, highest-yield transforms first.
    yield rgb
    yield gray

    height, width = gray.shape[:2]

    # A code can be printed light-on-dark (or photographed against a dark
    # table), which OpenCV's detector does not recover from unaided. Flipping
    # polarity is only worth trying when the frame is actually dark-biased.
    dark_heavy = float(gray.mean()) < 110.0
    if dark_heavy:
        yield cv2.bitwise_not(gray)

    for scale in (2, 4, 8):
        if max(height, width) * scale <= 4000:
            yield cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)

    # Binarise: separates the modules from uneven lighting, which is what makes
    # low-contrast and shadowed codes readable.
    _, otsu = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    yield otsu
    if dark_heavy:
        yield cv2.bitwise_not(otsu)

    # Local (adaptive) thresholding beats global thresholding when one side of
    # the photo is shadowed.
    adaptive = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 5
    )
    yield adaptive
    yield cv2.bitwise_not(adaptive)

    # CLAHE stretches local contrast, which rescues washed-out or faint codes
    # that Otsu binarisation flattens into a single tone.
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8)).apply(gray)
    yield clahe
    yield cv2.bitwise_not(clahe)


def _decode_qr_payloads(image: Image.Image) -> list[str]:
    """Return the payloads of every QR code found in a PIL image."""
    image = ImageOps.exif_transpose(image)
    rgb = np.array(image.convert("RGB"))
    detector = cv2.QRCodeDetector()
    found: list[str] = []

    for candidate in _qr_variants(rgb):
        # OpenCV has changed the arity of these calls across versions
        # (detectAndDecodeMulti returns 2, 3 or 4 values), so index instead of
        # unpacking a fixed number of results.
        try:
            multi = detector.detectAndDecodeMulti(candidate)
        except cv2.error:
            multi = None
        if multi and multi[0] and len(multi) > 1 and multi[1]:
            found.extend(p.strip() for p in multi[1] if isinstance(p, str) and p.strip())
        if not found:
            try:
                single = detector.detectAndDecode(candidate)
            except cv2.error:
                single = None
            if single and isinstance(single[0], str) and single[0].strip():
                found.append(single[0].strip())
        if found:
            break

    return _unique(found)


def _qr_url(payloads: list[str]) -> str:
    """Pick the first http(s) URL across the decoded payloads.

    A QR code may carry a bare link or a short line of text around it
    ("Scan to pay: https://..."), so fall back to treating a bare hostname as
    a URL rather than discarding a perfectly readable code.
    """
    for payload in payloads:
        for match in _URL_RE.findall(payload):
            return match.rstrip(".,;:)")
    for payload in payloads:
        candidate = payload.strip()
        if _BARE_HOST_RE.match(candidate):
            return "http://" + candidate
    return ""


@api.post("/scan-image")
async def scan_image(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    allowed = {"image/png", "image/jpeg", "image/jpg", "image/webp", "image/bmp", "image/tiff"}
    if file.content_type not in allowed:
        raise HTTPException(status_code=400, detail="Unsupported image type. Use PNG, JPG, WebP, BMP, or TIFF.")

    try:
        contents = await file.read()
        image = Image.open(io.BytesIO(contents))
        extracted_text = pytesseract.image_to_string(image).strip()
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Failed to process image: {exc}")

    loop = asyncio.get_event_loop()
    # A QR code is a much stronger signal than OCR text, and OCR usually mangles
    # the link inside one, so look for a QR code as well.
    try:
        qr_payloads = await loop.run_in_executor(None, _decode_qr_payloads, image)
    except Exception:
        qr_payloads = []
    qr_url = _qr_url(qr_payloads)

    if not extracted_text and not qr_url:
        # Same response shape as the normal path, so clients never have to
        # guard against a reduced payload on this branch.
        return {
"extracted_text": "",
        "qr_found": False,
        "qr_payloads": [],
        "qr_url": "",
        "urls_found": [],
            "emails_found": [],
            "scanned_url": "",
            "message_preview": "",
            "risk_score": 0.0,
            "verdict": "Safe",
            "url_reasons": [],
            "message_reasons": ["No readable text found in the image."],
            "recommendation": "Could not extract text. Try uploading a clearer image or paste the text manually.",
            "url_probability": 0.0,
            "message_probability": 0.0,
            "url_shap_features": [],
            "message_shap_features": [],
            "trusted_domain": "",
            "thresholds": {
                "safe": predictor_mod.SAFE_THRESHOLD,
                "phishing": predictor_mod.PHISHING_THRESHOLD,
            },
        }

    urls_found = _unique(_URL_RE.findall(extracted_text))
    emails_found = _unique(_EMAIL_RE.findall(extracted_text))

    # A decoded QR link is authoritative: OCR frequently drops the scheme and
    # separators ("http//paypat-securtktk"), so it must win over the OCR match.
    best_url = qr_url or (urls_found[0] if urls_found else "")
    urls_found = _unique(([qr_url] if qr_url else []) + urls_found)
    result = await _predict_with_reputation(best_url, extracted_text)

    doc = {
        "user_id": user["_id"],
        "url": best_url,
        "message": extracted_text[:5000],
        "risk_score": result["risk_score"],
        "verdict": result["verdict"],
        "url_reasons": result["url_reasons"],
        "message_reasons": result["message_reasons"],
        "recommendation": result["recommendation"],
        "ml_risk_score": result.get("ml_risk_score"),
        "reputation_bump": result.get("reputation_bump", 0.0),
        "reputation_signals": [s.get("label") for s in (result.get("reputation", {}).get("signals") or [])],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "source": "image",
    }
    await db.scans.insert_one(doc)

    return {
        "extracted_text": extracted_text[:5000],
        "qr_found": bool(qr_payloads),
        "qr_payloads": qr_payloads[:10],
        "qr_url": qr_url,
        "urls_found": urls_found[:10],
        "emails_found": emails_found[:10],
        "scanned_url": best_url,
        "message_preview": extracted_text[:200],
        "risk_score": result["risk_score"],
        "verdict": result["verdict"],
        "url_reasons": result["url_reasons"],
        "message_reasons": result["message_reasons"],
        "recommendation": result["recommendation"],
        "url_probability": result["url_probability"],
        "message_probability": result["message_probability"],
        "url_shap_features": result["url_shap_features"],
        "message_shap_features": result["message_shap_features"],
        "trusted_domain": result["trusted_domain"],
        "thresholds": result["thresholds"],
    }


# ---------- Scan a QR code ----------
@api.post("/scan-qr")
async def scan_qr(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    ctype = (file.content_type or "").split(";")[0].strip().lower()
    if ctype not in _QR_ALLOWED_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Unsupported image type. Use PNG, JPG, WebP, BMP, or TIFF.",
        )

    contents = await file.read()
    if len(contents) > _MAX_QR_BYTES:
        raise HTTPException(status_code=400, detail="Image too large (max 8MB).")

    try:
        image = Image.open(io.BytesIO(contents))
        image.load()
    except Exception:
        raise HTTPException(status_code=422, detail="Could not read the image.")

    loop = asyncio.get_event_loop()
    try:
        qr_payloads = await loop.run_in_executor(None, _decode_qr_payloads, image)
    except Exception as exc:
        logger.warning("QR decode failed: %s", exc)
        qr_payloads = []

    qr_url = _qr_url(qr_payloads)

    # Surrounding text (a caption, a sender name) still helps the message model.
    try:
        extracted_text = await loop.run_in_executor(None, pytesseract.image_to_string, image)
        extracted_text = extracted_text.strip()
    except Exception:
        extracted_text = ""

    if not qr_payloads and not extracted_text:
        return {
            "qr_found": False,
            "qr_payloads": [],
            "qr_url": "",
            "scanned_url": "",
            "extracted_text": "",
            "message_preview": "",
            "urls_found": [],
            "risk_score": 0.0,
            "verdict": "Safe",
            "url_reasons": [],
            "message_reasons": ["No QR code found in this image."],
            "recommendation": "No QR code could be decoded. Crop tightly around the code and make sure it is in focus.",
            "url_probability": 0.0,
            "message_probability": 0.0,
            "url_shap_features": [],
            "message_shap_features": [],
            "trusted_domain": "",
            "thresholds": {
                "safe": predictor_mod.SAFE_THRESHOLD,
                "phishing": predictor_mod.PHISHING_THRESHOLD,
            },
        }

    result = await _predict_with_reputation(qr_url, extracted_text)

    if not qr_payloads:
        # Never let a missing QR pass silently: say so, and note that only the
        # visible text was analysed instead.
        result["message_reasons"] = _unique(
            ["No QR code was detected in this image, so only its visible text was analysed."]
            + list(result["message_reasons"])
        )

    doc = {
        "user_id": user["_id"],
        "url": qr_url,
        "message": extracted_text[:5000],
        "risk_score": result["risk_score"],
        "verdict": result["verdict"],
        "url_reasons": result["url_reasons"],
        "message_reasons": result["message_reasons"],
        "recommendation": result["recommendation"],
        "ml_risk_score": result.get("ml_risk_score"),
        "reputation_bump": result.get("reputation_bump", 0.0),
        "reputation_signals": [s.get("label") for s in (result.get("reputation", {}).get("signals") or [])],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "source": "qr",
    }
    await db.scans.insert_one(doc)

    return {
        "qr_found": bool(qr_payloads),
        "qr_payloads": qr_payloads[:10],
        "qr_url": qr_url,
        "scanned_url": qr_url,
        "extracted_text": extracted_text[:5000],
        "message_preview": extracted_text[:200],
        "urls_found": ([qr_url] if qr_url else []),
        "risk_score": result["risk_score"],
        "verdict": result["verdict"],
        "url_reasons": result["url_reasons"],
        "message_reasons": result["message_reasons"],
        "recommendation": result["recommendation"],
        "url_probability": result["url_probability"],
        "message_probability": result["message_probability"],
        "url_shap_features": result["url_shap_features"],
        "message_shap_features": result["message_shap_features"],
        "trusted_domain": result["trusted_domain"],
        "thresholds": result["thresholds"],
    }


# ---------- Scan uploaded file ----------
@api.post("/scan-file")
async def scan_file(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    allowed_types = {
        "text/plain", "text/csv", "text/html", "text/plain; charset=utf-8",
        "application/csv", "message/rfc822", "text/email",
    }
    allowed_exts = {".txt", ".csv", ".html", ".htm", ".eml", ".log", ".md"}
    ctype = (file.content_type or "").split(";")[0].strip().lower()
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ctype not in allowed_types and ext not in allowed_exts:
        raise HTTPException(
            status_code=400,
            detail="Unsupported file type. Upload a plain-text file (.txt, .csv, .html, .eml).",
        )
    raw = await file.read()
    if len(raw) > 1_000_000:
        raise HTTPException(status_code=400, detail="File too large (max 1MB).")

    if b"\x00" in raw[:4096]:
        raise HTTPException(
            status_code=400,
            detail="This looks like a binary file, not readable text. Upload a .txt, .csv, .html or .eml file.",
        )

    try:
        text = raw.decode("utf-8", errors="replace").strip()
    except Exception:
        raise HTTPException(status_code=422, detail="Could not read file as text.")

    if not text:
        raise HTTPException(status_code=400, detail="File is empty.")

    urls_found = _unique(_URL_RE.findall(text))
    emails_found = _unique(_EMAIL_RE.findall(text))

    best_url = urls_found[0] if urls_found else ""
    result = await _predict_with_reputation(best_url, text)

    doc = {
        "user_id": user["_id"],
        "url": best_url,
        "message": text[:5000],
        "risk_score": result["risk_score"],
        "verdict": result["verdict"],
        "url_reasons": result["url_reasons"],
        "message_reasons": result["message_reasons"],
        "recommendation": result["recommendation"],
        "ml_risk_score": result.get("ml_risk_score"),
        "reputation_bump": result.get("reputation_bump", 0.0),
        "reputation_signals": [s.get("label") for s in (result.get("reputation", {}).get("signals") or [])],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "source": "file",
    }
    await db.scans.insert_one(doc)

    return {
        "filename": file.filename,
        "extracted_text": text[:5000],
        "urls_found": urls_found[:20],
        "emails_found": emails_found[:20],
        "scanned_url": best_url,
        "message_preview": text[:200],
        "risk_score": result["risk_score"],
        "verdict": result["verdict"],
        "url_reasons": result["url_reasons"],
        "message_reasons": result["message_reasons"],
        "recommendation": result["recommendation"],
        "url_probability": result["url_probability"],
        "message_probability": result["message_probability"],
        "url_shap_features": result["url_shap_features"],
        "message_shap_features": result["message_shap_features"],
        "trusted_domain": result["trusted_domain"],
        "thresholds": result["thresholds"],
    }


# ---------- Export scan history as CSV ----------
@api.get("/export")
async def export_scans(user: dict = Depends(get_current_user)):
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["id", "url", "message", "risk_score", "verdict", "created_at"])

    cur = db.scans.find({"user_id": user["_id"]}).sort("created_at", -1)
    async for doc in cur:
        writer.writerow([
            str(doc["_id"]),
            doc.get("url", ""),
            doc.get("message", ""),
            doc.get("risk_score", ""),
            doc.get("verdict", ""),
            doc.get("created_at", ""),
        ])

    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=scamsense_scans.csv"},
    )


# ---------- Wire up ----------
app.include_router(api)

# The frontend sends `withCredentials: true`, and browsers reject a credentialed
# response whose Access-Control-Allow-Origin is the wildcard "*". Configuring "*"
# therefore looks fine from curl or Postman but fails in the browser with a generic
# "Network Error". Default to the CRA dev origins and treat "*" as a misconfiguration.
_origins = [
    o.strip()
    for o in os.environ.get(
        "CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
    ).split(",")
    if o.strip()
]
_allow_credentials = "*" not in _origins and bool(_origins)

if not _allow_credentials:
    import logging

    logging.getLogger("scamsense").warning(
        "CORS_ORIGINS is a wildcard, so credentialed requests will be blocked by the "
        "browser. List the frontend origins explicitly instead, e.g. "
        "CORS_ORIGINS=\"http://localhost:3000,http://127.0.0.1:3000\""
    )

app.add_middleware(
    CORSMiddleware,
    allow_credentials=_allow_credentials,
    allow_origins=_origins or ["*"],
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)


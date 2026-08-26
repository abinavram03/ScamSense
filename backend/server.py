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
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta
from typing import Optional

import bcrypt
import jwt
import pytesseract
from bson import ObjectId
from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends, UploadFile, File
from fastapi.responses import StreamingResponse
from motor.motor_asyncio import AsyncIOMotorClient
from PIL import Image
from pydantic import BaseModel, EmailStr, Field
from starlette.middleware.cors import CORSMiddleware

from predictor import predictor

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


# ---------- Predict ----------
@api.post("/predict")
async def predict(payload: PredictIn, user: dict = Depends(get_current_user)):
    if not (payload.url or "").strip() and not (payload.message or "").strip():
        raise HTTPException(status_code=400, detail="Provide at least a URL or a message.")
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, predictor.predict, payload.url, payload.message)
    doc = {
        "user_id": user["_id"],
        "url": payload.url,
        "message": payload.message,
        "risk_score": result["risk_score"],
        "verdict": result["verdict"],
        "url_reasons": result["url_reasons"],
        "message_reasons": result["message_reasons"],
        "recommendation": result["recommendation"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.scans.insert_one(doc)
    result["scanned_url"] = payload.url
    result["message_preview"] = payload.message[:200]
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


# ---------- Quick URL check (public, no auth) ----------
class QuickCheckIn(BaseModel):
    url: str = Field(min_length=1)


@api.post("/scan-url")
async def quick_url_check(payload: QuickCheckIn):
    url = payload.url.strip()
    result = predictor.predict(url, "")
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

    if not extracted_text:
        return {
            "extracted_text": "",
            "urls_found": [],
            "emails_found": [],
            "risk_score": 0.0,
            "verdict": "Safe",
            "url_reasons": [],
            "message_reasons": ["No readable text found in the image."],
            "recommendation": "Could not extract text. Try uploading a clearer image or paste the text manually.",
            "url_probability": 0.0,
            "message_probability": 0.0,
        }

    urls_found = list(set(_URL_RE.findall(extracted_text)))
    emails_found = list(set(_EMAIL_RE.findall(extracted_text)))

    best_url = urls_found[0] if urls_found else ""
    result = predictor.predict(best_url, extracted_text)

    doc = {
        "user_id": user["_id"],
        "url": best_url,
        "message": extracted_text[:5000],
        "risk_score": result["risk_score"],
        "verdict": result["verdict"],
        "url_reasons": result["url_reasons"],
        "message_reasons": result["message_reasons"],
        "recommendation": result["recommendation"],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "source": "image",
    }
    await db.scans.insert_one(doc)

    return {
        "extracted_text": extracted_text[:5000],
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
        "thresholds": result["thresholds"],
    }


# ---------- Scan uploaded file ----------
@api.post("/scan-file")
async def scan_file(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    allowed_types = {"text/plain", "text/csv", "text/html", "application/csv", "application/octet-stream"}
    raw = await file.read()
    if len(raw) > 1_000_000:
        raise HTTPException(status_code=400, detail="File too large (max 1MB).")

    try:
        text = raw.decode("utf-8", errors="replace").strip()
    except Exception:
        raise HTTPException(status_code=422, detail="Could not read file as text.")

    if not text:
        raise HTTPException(status_code=400, detail="File is empty.")

    urls_found = list(set(_URL_RE.findall(text)))
    emails_found = list(set(_EMAIL_RE.findall(text)))

    best_url = urls_found[0] if urls_found else ""
    result = predictor.predict(best_url, text)

    doc = {
        "user_id": user["_id"],
        "url": best_url,
        "message": text[:5000],
        "risk_score": result["risk_score"],
        "verdict": result["verdict"],
        "url_reasons": result["url_reasons"],
        "message_reasons": result["message_reasons"],
        "recommendation": result["recommendation"],
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

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)


# ScamSense

**Explainable phishing detection for URLs, messages, emails, files, and images — with a plain-language reason behind every verdict.**

Most phishing tools tell you *that* something is malicious. ScamSense also tells you *why*, using SHAP explainability, so you can verify the warning and actually learn to spot the scam.

---

## Key Features

- **Five input types** — URL, message, email, file upload, and image
- **Two RandomForest models** — one trained on 13 hand-crafted URL features, one on TF-IDF message vectors
- **Unified risk score** — `0.5 × P(url) + 0.5 × P(message)` when both are present
- **Three clear verdicts** — `Safe` · `Suspicious` · `Phishing`
- **SHAP explanations** — top 3 contributing features per model, rendered in plain language
- **OCR support** — Tesseract extracts text from scam screenshots to analyse
- **Scan history & stats** — stored in MongoDB, with CSV export
- **JWT auth** — bcrypt-hashed passwords, httpOnly cookies
- **Graceful degradation** — falls back to an in-memory Mongo mock if no database is running

---

## How It Works

```
Input (URL / Message / Email / File / Image)
        │
        ├─ URL ────► 13 feature extraction ──┐
        ├─ Message ─► TF-IDF vectorization ──┤
        └─ Image ───► Tesseract OCR ─────────┘   (then as message text)
        │
        ▼
  RandomForest models  (URL model + Message model)
        │
        ▼
  Combined risk score  →  Safe / Suspicious / Phishing
        │
        ▼
  SHAP TreeExplainer  →  top 3 reasons, in plain language
```

---

## Model Performance

| Model | Input | Accuracy | AUC-ROC |
|---|---|---|---|
| URL RandomForest | 13 URL features | **100.00%** | **1.0000** |
| Message RandomForest | TF-IDF vectors (1–2 grams, 5000 features) | **97.94%** | **0.9854** |

Training is fully seeded (`random_state=42`), so these figures are reproducible.

### The 13 URL features

`url_length` · `dot_count` · `special_char_count` · `has_ip` · `has_https` · `suspicious_keyword_count` · `tld_suspicious` · `subdomain_depth` · `is_known_safe_domain` · `has_url_shortener` · `url_entropy` · `has_at_symbol` · `path_depth`

### Risk thresholds

| Risk score | Verdict |
|---|---|
| `< 0.40` | Safe |
| `0.40 – 0.58` | Suspicious |
| `≥ 0.58` | Phishing |

A trusted-domain whitelist can never push a known-good domain above `0.39`.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | FastAPI, Uvicorn, Pydantic |
| Auth | PyJWT (HS256), bcrypt |
| Database | MongoDB via Motor (falls back to `mongomock-motor`) |
| ML | scikit-learn (RandomForest), SHAP TreeExplainer |
| NLP | TF-IDF vectorization (scikit-learn) |
| OCR | Tesseract via `pytesseract` + Pillow |
| Frontend | React 19, React Router 7, Tailwind CSS 3, CRACO |
| Data fetching | Axios, TanStack Query |
| Icons | Lucide React |

---

## Project Structure

```
Mini project/
├── backend/
│   ├── server.py            # FastAPI app, all /api routes, auth, OCR, uploads
│   ├── predictor.py         # Model loading, SHAP, risk scoring, reason text
│   ├── train_models.py      # Feature extraction + RandomForest training
│   ├── requirements.txt
│   ├── models/              # .joblib bundles  (git-ignored)
│   └── data/                # datasets         (git-ignored)
├── frontend/
│   ├── src/
│   │   ├── pages/           # Login, Signup, Dashboard
│   │   ├── components/      # ResultCard, InputPreview
│   │   ├── context/         # AuthContext
│   │   ├── lib/             # api.js (axios instance)
│   │   └── App.js
│   ├── craco.config.js
│   ├── tailwind.config.js
│   └── .env
├── memory/                  # PRD, test credentials, flowchart
└── README.md
```

---

## Setup

### Prerequisites

- Python 3.10+
- Node.js 18+
- MongoDB (optional — the app runs without it using an in-memory mock)
- [Tesseract OCR](https://github.com/tesseract-ocr/tesseract) (optional — only needed for image scanning)

### 1. Backend

```bash
cd backend

python -m venv venv
source venv/Scripts/activate        # Windows: venv\Scripts\activate

pip install -r requirements.txt

cp .env.example .env                # then edit it
python server.py
```

The API runs on **http://localhost:8000** — interactive docs at **http://localhost:8000/docs**.

> On the first run the app **trains both models automatically** if `models/*.joblib` are missing. To train manually instead:
> ```bash
> python train_models.py
> ```

### 2. Frontend

```bash
cd frontend

npm install

# frontend/.env
# REACT_APP_BACKEND_URL=http://localhost:8000

npm start
```

The UI runs on **http://localhost:3000**.

### 3. Sign in

| Email | Password |
|---|---|
| `ScamSense@admin.com` | `SS012` |

Or create your own account on the signup screen.

---

## Environment Variables

`backend/.env`:

| Variable | Default | Description |
|---|---|---|
| `MONGO_URL` | `mongodb://localhost:27017` | MongoDB connection string |
| `DB_NAME` | `test_database` | Database name |
| `CORS_ORIGINS` | `*` | Comma-separated allowed origins |
| `JWT_SECRET` | *(required)* | Signing key for access tokens — use a long random value |
| `ADMIN_EMAIL` | `ScamSense@admin.com` | Seeded admin account |
| `ADMIN_PASSWORD` | `SS012` | Seeded admin password |
| `ENV` | — | Set to `production` to enable secure cookies |

`frontend/.env`:

| Variable | Default | Description |
|---|---|---|
| `REACT_APP_BACKEND_URL` | `http://localhost:8000` | Backend base URL |
| `ENABLE_HEALTH_CHECK` | `false` | Health polling toggle |

> **Security note:** `.env` files are git-ignored and must never be committed. Rotate `JWT_SECRET` and change the admin password before deploying anywhere public.

---

## API

Base URL: `http://localhost:8000/api`

| Method | Endpoint | Auth | Purpose |
|---|---|:--:|---|
| `POST` | `/auth/register` | — | Create account, returns token |
| `POST` | `/auth/login` | — | Sign in, returns token |
| `POST` | `/auth/logout` | ✓ | Clear auth cookie |
| `GET` | `/auth/me` | ✓ | Current user |
| `POST` | `/predict` | ✓ | Analyse a URL and/or message |
| `POST` | `/scan-url` | — | Analyse a URL only (public) |
| `POST` | `/scan-image` | ✓ | Upload an image, extract text with OCR, analyse |
| `POST` | `/scan-file` | ✓ | Upload a `.txt` / `.csv` / `.html` / `.eml` file, analyse |
| `GET` | `/scans` | ✓ | Scan history |
| `GET` | `/scans/{id}` | ✓ | Full detail of one scan |
| `DELETE` | `/scans/{id}` | ✓ | Delete a scan |
| `GET` | `/stats` | ✓ | Aggregate counts and average risk |
| `GET` | `/export` | ✓ | Download scans as CSV |
| `GET` | `/health` | — | Liveness and model-ready status |

**Example — analyse a URL and message:**

```bash
curl -X POST http://localhost:8000/api/predict \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your_token>" \
  -d '{
    "url": "http://secure-verify-login.account-otp.com/confirm",
    "message": "URGENT: your account is suspended, verify your OTP now"
  }'
```

**Response:**

```json
{
  "risk_score": 0.9412,
  "verdict": "Phishing",
  "url_reasons": ["No HTTPS — the connection is not encrypted", "Contains 19 suspicious keywords: login, verify, account, otp"],
  "message_reasons": ["Urgency / pressure language detected", "Requests OTP / password / verification code"],
  "recommendation": "Do not click. Delete the message and report to your IT helpdesk.",
  "url_probability": 0.9871,
  "message_probability": 0.8953,
  "url_shap_features": [
    { "feature": "suspicious_keyword_count", "value": 3, "contribution": 0.214 },
    { "feature": "has_https", "value": 0, "contribution": 0.061 },
    { "feature": "tld_suspicious", "value": 1, "contribution": 0.048 }
  ],
  "message_shap_features": [
    { "feature": "urgent", "value": 1, "contribution": 0.093 },
    { "feature": "otp", "value": 1, "contribution": 0.081 }
  ],
  "thresholds": { "safe": 0.4, "phishing": 0.58 }
}
```

---

## Datasets

| Dataset | Use |
|---|---|
| UCI SMS Spam Collection | Message model (5,572 labelled SMS) |
| Synthetic URL corpus | URL model (2,000 legit + 2,000 phishing) |
| Synthetic message corpus | Fallback if the SMS download fails |

Datasets and trained models are git-ignored and regenerated locally. Place your own files in `backend/data/` and re-run `python train_models.py`.

---

## Team

| Role | Name |
|---|---|
| Team Leader | V. Abinavram |
| Team Member | G. Balamurugan |
| Team Member | R. Elamathiyan |
| Guide | Dr. R. Jamuna |

**Institution:** VSB College of Engineering Technical Campus, Coimbatore

---

## License

For academic and educational use.

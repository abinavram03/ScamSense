<div align="center">

# 🛡️ ScamSense

**Explainable phishing detection for URLs, messages, emails, files, images, and QR codes.**

Most phishing tools tell you *that* something is malicious. ScamSense also tells you *why*, using SHAP
explainability, so you can verify the warning and actually learn to spot the scam.

`Python` `FastAPI` `React` `scikit-learn` `SHAP`

</div>

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [How It Works](#how-it-works)
- [Domain Reputation Analysis](#domain-reputation-analysis)
- [Message Translation](#message-translation)
- [QR Code Scanning](#qr-code-scanning)
- [Model Performance](#model-performance)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Setup](#setup)
- [Environment Variables](#environment-variables)
- [API Reference](#api-reference)
- [Design Decisions](#design-decisions)
- [Limitations](#limitations)
- [Team](#team)
- [License](#license)

---

## Overview

ScamSense takes a suspicious link or message and returns a single risk score with a written reason for
it. The input can arrive six different ways — pasted as a URL, pasted as message text, uploaded as an
email or file, photographed as a screenshot, or hidden in a QR code.

Underneath, two RandomForest models score the URL and the message text independently. A separate
reputation layer then asks external threat-intelligence sources what is actually known about the
domain being visited, and the results are combined into one final verdict.

---

## Key Features

### Detection

| Capability | Detail |
|---|---|
| **Six input types** | URL · message · email · file · image · QR code |
| **Two RandomForest models** | one on 13 hand-crafted URL features, one on TF-IDF message vectors |
| **Unified risk score** | `0.5 × P(url) + 0.5 × P(message)` when both are present |
| **Three clear verdicts** | `Safe` · `Suspicious` · `Phishing` |
| **SHAP explanations** | top 3 contributing features per model, in plain language |
| **OCR support** | Tesseract extracts text from scam screenshots |

### Threat intelligence

| Capability | Detail |
|---|---|
| **Domain reputation** | Google Safe Browsing, VirusTotal, OpenPhish, RDAP, DNS and redirect tracing |
| **Capped, bounded adjustment** | reputation adds at most 40 points and can never overrule the model |
| **Transparent arithmetic** | the UI shows `ML score + reputation = final score` explicitly |

### Experience

| Capability | Detail |
|---|---|
| **19-language translation** | the message, the reasons and the advice, with the verdict never translated |
| **Scan history & stats** | stored in MongoDB, with CSV export |
| **JWT auth** | bcrypt-hashed passwords, httpOnly cookies |
| **Graceful degradation** | falls back to an in-memory Mongo mock if no database is running |

---

## How It Works

```
Input (URL / Message / Email / File / Image / QR)
        │
        ├─ URL ────► 13 feature extraction ──┐
        ├─ Message ─► TF-IDF vectorization ──┤
        ├─ Image ───► Tesseract OCR ─────────┤
        ├─ Email ───► MIME / header parsing ─┤
        └─ QR ──────► payload decode ────────┘   (links then feed back into the URL path)
        │
        ├──────────────────────────┐
        ▼                          ▼
  RandomForest models        Domain reputation
  (URL + Message)            (Safe Browsing, VirusTotal,
        │                     OpenPhish, RDAP, DNS, redirects)
        ▼                          │
  ML risk score                     │  capped at +40
        └───────────► Risk engine ◄──┘
                        │
                        ▼
          final = min(1.0, ML + reputation)
                        │
                        ▼
          Safe / Suspicious / Phishing
                        │
                        ▼
        SHAP explains the ML score · reputation
        reasons are listed separately and added up
```

The two halves are deliberately independent, and this matters more than it might look:

- The **models** read the URL as *text*. They are fast and offline, but they have never seen a domain
  registered this morning. `amazon.com/login-verify-otp.xyz` and `paypa1-secure-login.com` look
  structurally similar, and the models can only say the URL *looks like* phishing.
- The **reputation layer** asks the outside world about *that specific domain*. It catches the
  newly-registered lookalike, but it is blind to a novel tactic that no blocklist has seen yet.

Each covers what the other misses.

---

## Domain Reputation Analysis

The models judge a URL's *shape*. Reputation judges the *domain's history*. The two fail in opposite
directions, so the pipeline uses both.

### Sources

`backend/reputation.py` queries these in parallel, with caching and a 7-second timeout each.

| Source | Key | What it tells us |
|---|---|---|
| Google Safe Browsing | `GOOGLE_SAFE_BROWSING_API_KEY` | Whether Google has already flagged the domain |
| VirusTotal | `VIRUSTOTAL_API_KEY` | How many of ~70 engines flag it |
| OpenPhish | none | Presence in the community phishing feed |
| RDAP | none | Registration date, registrar, nameservers |
| DNS | none | Whether the domain resolves at all |
| Redirect trace | none | Hop count, final host, cross-domain or HTTPS downgrade |

Every source **fails soft**. A timeout, a missing key or an unreachable server degrades that one
signal and nothing else — the scan always completes.

### How the points work

| Signal | Points |
|---|---|
| Listed as malicious (Safe Browsing or OpenPhish) | +20 |
| Domain does not resolve in DNS | +10 |
| 3+ VirusTotal engines agree | +10 |
| Registered under 30 days ago | +5 |
| Suspicious redirect chain (3+ hops) | +5 |

```
final = min(1.0, ML risk score + points)
```

### Three rules that keep this honest

1. **It can only add, never subtract.** A clean reputation scan cannot rescue a URL the model dislikes.
   That decision belongs to the model alone.
2. **The +40 cap means reputation cannot convict on its own.** A clean ML score of `0.10` plus the
   maximum possible bump reaches `0.50` — still `Suspicious`, never `Phishing`. Reputation confirms the
   model; it does not overrule it.
3. **Trusted domains are immune.** The 166-domain whitelist stays pinned below `0.39` regardless of what
   any external source claims, so a false positive cannot condemn `amazon.com`.

### Seeing the arithmetic

The result panel shows the ML score, the reputation bump and the final score as explicit arithmetic
rather than a single opaque number:

```
ML model 68%   +   Reputation 10   =   Final 78%   →  Phishing
```

SHAP explains the **ML score only**. That split is intentional and visible in the UI — the panel shows
exactly what moved the number, instead of attributing reputation evidence to features the model never
saw.

### Safety

The redirect tracer fetches the URL to count hops, which makes it an SSRF risk. It refuses any host
that resolves to a private, loopback, link-local (`169.254.169.254`), multicast, reserved or otherwise
non-public address.

---

## Message Translation

Scam messages arrive in the victim's language, so the warnings should too.

- **19 languages** — English, हिन्दी, தமிழ், తెలుగు, ಕನ್ನಡ, മലയാളം, বাংলা, ગુજરાતી, मराठी, ਪੰਜਾਬੀ, ଓଡ଼ିଆ, العربية, Русский, Español, Français, Deutsch, 中文, 日本語, 한국어
- **The whole result is translated** — the message body, the detection reasons, and the recommended action
- **The verdict is never translated.** It stays as `Safe` / `Suspicious` / `Phishing`, because machine
  translation must not be able to change a security decision
- **Source language is detected automatically**, so the reader does not have to tell the app what they
  sent

### Handling a free public API

MyMemory's keyless endpoint has two sharp edges, both handled:

- **500-character request limit** — long messages are split on sentence boundaries, then word
  boundaries, translated in chunks and rejoined
- **Daily word quota per IP** — when exhausted the API still returns `200 OK` with an error string in
  the body. ScamSense detects that and returns a clear *"quota used up"* message instead of rendering
  that string as if it were a translation

Adding `MYMEMORY_EMAIL` or `MYMEMORY_API_KEY` in `backend/.env` lifts the quota to 50,000+ words/day.

---

## QR Code Scanning

Quishing — a malicious link delivered as a QR code — bypasses most link filters, because the URL is
never visible as text to scan.

`POST /api/scan-qr` decodes an uploaded image with OpenCV (`QRCodeDetector`) after a short
preprocessing chain, then:

- reports **every** payload found, not just the first, so a multi-code image is fully covered
- feeds each decoded link through the same risk engine as a typed URL
- still runs the OCR pass, because a scam poster often puts the real message in printed text around the
  code
- clearly flags the case where a code was found but carries no link at all

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

A trusted-domain whitelist can never push a known-good domain above `0.39`, and the reputation layer is
capped at +40 on top of that. See [Domain Reputation Analysis](#domain-reputation-analysis).

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
| QR decoding | OpenCV (`opencv-python-headless`) — grayscale, upscale, Otsu threshold, `QRCodeDetector` |
| Threat intel | Google Safe Browsing v4, VirusTotal v3, OpenPhish, RDAP |
| Translation | MyMemory API with sentence/word chunking |
| Frontend | React 19, React Router 7, Tailwind CSS 3, CRACO |
| Data fetching | Axios, TanStack Query |
| Icons | Lucide React |

---

## Project Structure

```
Mini project/
├── backend/
│   ├── server.py            # FastAPI app, all /api routes, auth, OCR, QR, uploads
│   ├── predictor.py         # Model loading, SHAP, risk scoring, reputation layer
│   ├── reputation.py        # Threat-intelligence sources, scoring, SSRF guard
│   ├── train_models.py      # Feature extraction + RandomForest training
│   ├── requirements.txt
│   ├── models/              # .joblib bundles  (git-ignored)
│   └── data/                # datasets         (git-ignored)
├── frontend/
│   ├── src/
│   │   ├── pages/           # Login, Signup, Dashboard
│   │   ├── components/      # ResultCard, DomainReputationPanel, InputPreview
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

**Optional — domain reputation:**

| Variable | Default | Description |
|---|---|---|
| `GOOGLE_SAFE_BROWSING_API_KEY` | — | [Free key](https://developers.google.com/safe-browsing/v4/get-started). Without it this source reports `not_configured` and the other five still run. |
| `VIRUSTOTAL_API_KEY` | — | [Free key](https://www.virustotal.com/gui/my-apikey). Same graceful behaviour. |

**Optional — translation:**

| Variable | Default | Description |
|---|---|---|
| `MYMEMORY_EMAIL` | — | Raises the quota to 50,000 words/day, no signup needed |
| `MYMEMORY_API_KEY` | — | Higher limits from [mymemory.com](https://mymemory.translated.net/doc/spec.php) |

ScamSense runs fully without any of these. Reputation still works off RDAP, DNS, OpenPhish and
redirect tracing; translation runs on the keyless MyMemory quota.

`frontend/.env`:

| Variable | Default | Description |
|---|---|---|
| `REACT_APP_BACKEND_URL` | `http://localhost:8000` | Backend base URL |
| `ENABLE_HEALTH_CHECK` | `false` | Health polling toggle |

> **Security note:** `.env` files are git-ignored and must never be committed. Rotate `JWT_SECRET` and change the admin password before deploying anywhere public.

---

## API Reference

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
| `POST` | `/scan-qr` | ✓ | Decode QR codes in an image, analyse every link found |
| `POST` | `/scan-file` | ✓ | Upload a `.txt` / `.csv` / `.html` / `.eml` file, analyse |
| `GET` | `/languages` | — | Supported translation languages |
| `POST` | `/translate` | ✓ | Translate message, reasons and recommendation |
| `GET` | `/scans` | ✓ | Scan history |
| `GET` | `/scans/{id}` | ✓ | Full detail of one scan |
| `DELETE` | `/scans/{id}` | ✓ | Delete a scan |
| `GET` | `/stats` | ✓ | Aggregate counts and average risk |
| `GET` | `/export` | ✓ | Download scans as CSV |
| `GET` | `/health` | — | Liveness and model-ready status |
| `DELETE` | `/scans` | ✓ | Clear scan history |

**Example — analyse a URL and message:**

```bash
curl -X POST http://localhost:8000/api/predict \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your_token>" \
  -d '{
    "url": "http://paypa1-verify-account.xyz/verify",
    "message": "URGENT: your account is suspended, verify your OTP now"
  }'
```

**Response:**

```json
{
  "risk_score": 0.7848,
  "verdict": "Phishing",
  "ml_risk_score": 0.6848,
  "reputation_bump": 0.1,
  "url_reasons": [
    "Suspicious keywords in URL (login/verify/otp/etc.)",
    "Domain does not resolve in DNS"
  ],
  "message_reasons": [
    "Urgency / pressure language detected",
    "Requests OTP / password / verification code"
  ],
  "recommendation": "Do not click. Delete the message and report to your IT helpdesk.",
  "url_probability": 1.0,
  "message_probability": 0.3696,
  "url_shap_features": [
    { "feature": "suspicious_keyword_count", "value": 2.0, "contribution": 0.1666 }
  ],
  "trusted_domain": "",
  "reputation": {
    "domain": "paypa1-verify-account.xyz",
    "available": true,
    "bump": 0.1,
    "max_bump": 0.4,
    "signals": [
      {
        "key": "no_dns",
        "label": "Domain does not resolve in DNS",
        "points": 10.0,
        "source": "DNS"
      }
    ],
    "providers": {
      "rdap":        { "status": "not_found", "note": "unregistered, or TLD not served by RDAP" },
      "dns":         { "status": "no_dns", "ips": [] },
      "safe_browsing": { "status": "not_configured", "detail": "Add GOOGLE_SAFE_BROWSING_API_KEY to backend/.env" },
      "virustotal":  { "status": "not_configured", "detail": "Add VIRUSTOTAL_API_KEY to backend/.env" },
      "openphish":   { "status": "ok", "listed": false, "feed_size": 300 },
      "redirects":   { "status": "unreachable", "detail": "ConnectionError" }
    },
    "notes": ["Google Safe Browsing: not configured", "VirusTotal: not configured"]
  },
  "thresholds": { "safe": 0.4, "phishing": 0.58 }
}
```

Note how `ml_risk_score` (0.6848), `reputation_bump` (0.1) and `risk_score` (0.7848) are all returned
separately, so a client can always show its working.

**Example — translate a scan result:**

```bash
curl -X POST http://localhost:8000/api/translate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your_token>" \
  -d '{
    "text": "URGENT: your account is suspended. Verify your OTP now",
    "reasons": ["Domain does not resolve in DNS"],
    "target": "ta",
    "verdict": "Phishing",
    "recommendation": "Do not click. Delete the message and report to your IT helpdesk."
  }'
```

**Response:**

```json
{
  "source_language": "en",
  "source_language_name": "English (English)",
  "target_language": "ta",
  "target_language_name": "Tamil (தமிழ்)",
  "translated_text": "அவசரம்: உங்கள் கணக்கு இடைநிறுத்தப்பட்டுள்ளது...",
  "translated_verdict": "ஃபிஷிங்",
  "translated_reasons": ["DNS இல் டொமைன் தீர்க்கப்படவில்லை"],
  "translated_recommendation": "கிளிக் செய்ய வேண்டாம்...",
  "explanation_translated": true,
  "skipped": false,
  "note": "Machine translation can be inaccurate. Trust the verdict, not the translation."
}
```

---

## Design Decisions

A few choices worth explaining, because each one trades something away.

**Why reputation can never lower a score.**
Allowing external data to *reduce* risk would let a stale or wrong blocklist vouch for a malicious
site. Reputation only ever adds, and only up to 40 points, so it can corroborate the model without
overruling it.

**Why the verdict is never translated.**
Machine translation is unreliable enough that a mistranslated warning could soften a real threat or
sharpen a false alarm. The verdict stays in English; everything explanatory is translated.

**Why SHAP explains only the ML score.**
SHAP TreeExplainer attributes a model's output to its own inputs. Reputation evidence is not a model
input, so attributing it via SHAP would be false. Instead the UI shows the arithmetic directly, which
is more honest and easier to verify.

**Why URLs are extracted from messages.**
A link pasted into a message is the actual threat, so it is extracted and scored through the URL
model. Without this, a message containing a known-bad link could score `Safe` because only the message
text was analysed.

**Why the OpenPhish feed is cached by content, not by answer.**
An early version cached "is this domain listed?" per domain under one global key, so every later
domain in the hour reused the first domain's verdict. It now caches the downloaded feed and evaluates
membership against it.

---

## Datasets

| Dataset | Use |
|---|---|
| UCI SMS Spam Collection | Message model (5,572 labelled SMS) |
| Synthetic URL corpus | URL model (2,000 legit + 2,000 phishing) |
| Synthetic message corpus | Fallback if the SMS download fails |

Datasets and trained models are git-ignored and regenerated locally. Place your own files in `backend/data/` and re-run `python train_models.py`.

---

## Limitations

Stated plainly, because a security tool that oversells itself is worse than useless.

- **The message model is English-only.** It was trained on the UCI SMS Spam Collection. Message text in
  Hindi, Tamil or Arabic is tokenised into mostly unknown tokens, so the message score contributes
  little. Links inside those messages are still checked through the URL model, and reputation still
  applies to the domain.
- **100% URL-model accuracy is not a real-world claim.** The URL training set is synthetic and
  generated locally, so the score reflects a separable benchmark rather than live phishing. Treat it
  as a working pipeline, not a validated production detector.
- **Reputation needs API keys to be fully useful.** Without `GOOGLE_SAFE_BROWSING_API_KEY` and
  `VIRUSTOTAL_API_KEY`, only four of six sources run. The two-keyed ones are the strongest signals.
- **OpenPhish only covers what is publicly listed** — roughly 300 domains in the community feed. It is a
  weak signal on its own.
- **Redirect tracing will not follow a host that refuses to connect**, which is common for
  already-dead phishing infrastructure. `unreachable` is a normal outcome, not an error.
- **Machine translation can distort a warning.** The verdict is kept in English for exactly this
  reason. Trust the verdict, not the translation.
- **Tesseract has only `eng` and `osd` language packs installed**, so OCR on non-English screenshots
  will be poor.

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

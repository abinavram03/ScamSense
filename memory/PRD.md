# ScamSense — PRD

## Problem statement (original)
Build ScamSense — a student cybersecurity mini-project that detects phishing URLs and scam messages together, explains predictions with SHAP, and returns a plain-language safety recommendation. Frontend: single-page React app with URL + Message inputs, submit, and a result card (risk_score %, color-coded verdict, url/message reasons, recommendation). Backend: FastAPI + scikit-learn RandomForest + SHAP TreeExplainer, POST /predict endpoint. User asked for creative visual design and a login page.

## Architecture
- Backend: FastAPI (`/app/backend/server.py`) on port 8000 with `/api` prefix
  - `predictor.py` — ScamSensePredictor loads/caches two RF models + SHAP TreeExplainer
  - `train_models.py` — trains from synthetic (Kaggle-style) URL + SMS-spam-style datasets on first startup
  - MongoDB collections: `users`, `scans`
  - JWT auth via httpOnly cookies + `Authorization: Bearer` fallback
- Frontend: React + Tailwind (dark "Tactical Minimalism" aesthetic)
  - Routes: `/login`, `/signup`, `/` (protected)
  - Fonts: Inter (body), JetBrains Mono (data)

## Implemented (2026-02-04)
- Two-model detection pipeline (URL RF + message RF w/ TF-IDF)
- SHAP TreeExplainer for both models -> top-3 plain-language reasons
- Combined risk score with configurable weights + verdict thresholds
- JWT auth (register / login / logout / me)
- Seeded admin account (ScamSense@admin.com / SS012)
- Login + Signup pages with animated gradient orbs + glassmorphism
- Dashboard: URL + Message inputs, example chips, loading state, result card with color-coded verdict, recent-scan history
- Scan history persisted per user in MongoDB
- Circular progress gauge with animated SVG
- Staggered reason item animations
- Scan stats panel (total, phishing, suspicious, safe)
- CSV export of scan history
- Individual scan detail view
- Quick URL check endpoint (public, no auth)

## Backlog
- Shareable "safe-scan" links so users can send a scan verdict to a friend
- Bulk paste — scan an entire inbox
- Password reset flow
- Deep-link scanning: fetch and inspect page headers (server-side)

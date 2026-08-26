"""
Loads trained models and produces the /api/predict response payload:
combines two RandomForest models with SHAP TreeExplainer for
plain-language reasons.
"""
from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import shap

from train_models import (
    extract_url_features,
    URL_FEATURE_NAMES,
    KNOWN_SAFE_DOMAINS,
    _get_registered_domain,
    train as train_models_now,
)

# ---------- Config constants (tunable, exposed at top for the demo/report) ----------
URL_WEIGHT: float = 0.5
MESSAGE_WEIGHT: float = 0.5
SAFE_THRESHOLD: float = 0.4
PHISHING_THRESHOLD: float = 0.58
TOP_K_REASONS: int = 3

RECOMMENDATIONS = {
    "Safe": "Looks clean. Still, avoid sharing OTPs or passwords over messages.",
    "Suspicious": "Be cautious. Verify the sender through a trusted channel before clicking any link.",
    "Phishing": "Do not click. Delete the message and report to your IT helpdesk.",
}

MODEL_DIR = Path(__file__).parent / "models"


# ---------- Plain-language mappers ----------
def _url_reason_for_feature(name: str, value: float) -> str | None:
    if name == "has_https":
        return "No HTTPS (insecure connection)" if value == 0 else None
    if name == "has_ip":
        return "IP address in URL instead of domain" if value == 1 else None
    if name == "suspicious_keyword_count":
        return "Suspicious keywords in URL (login/verify/otp/etc.)" if value >= 1 else None
    if name == "dot_count":
        return "Unusually deep subdomain nesting" if value >= 4 else None
    if name == "url_length":
        return "Abnormally long URL" if value >= 60 else None
    if name == "special_char_count":
        return "Excess special characters in URL" if value >= 4 else None
    # --- New feature reasons ---
    if name == "tld_suspicious":
        return "Suspicious top-level domain (e.g. .xyz, .top, .tk, .click)" if value == 1 else None
    if name == "subdomain_depth":
        return "Excessive subdomain nesting (impersonation pattern)" if value >= 2 else None
    if name == "is_known_safe_domain":
        return None  # Positive signal — no warning needed
    if name == "has_url_shortener":
        return "URL shortener used to hide real destination" if value == 1 else None
    if name == "url_entropy":
        return "Randomly-generated looking domain name" if value >= 4.5 else None
    if name == "has_at_symbol":
        return "@ symbol in URL (browser domain-spoofing trick)" if value == 1 else None
    if name == "path_depth":
        return "Unusually deep URL path (obfuscation pattern)" if value >= 4 else None
    return None


URGENCY_WORDS = {"urgent", "immediately", "now", "asap", "final", "warning", "act", "expire",
                 "arrest", "blocked", "suspended", "disconnected", "illegal", "action", "freeze"}
CREDENTIAL_WORDS = {"otp", "password", "pin", "cvv", "verify", "confirm", "credentials", "kyc"}
MONEY_WORDS = {"prize", "won", "winner", "reward", "gift", "bonus", "inheritance", "free", "$",
               "lakh", "crore", "rs.", "lottery", "cashback", "refund", "claim"}
LINK_WORDS = {"click", "link", "http", "https", "bit.ly", "tinyurl", "visit", "tap here"}


def _message_semantic_reasons(text: str) -> list[str]:
    t = (text or "").lower()
    reasons: list[str] = []
    if any(w in t for w in URGENCY_WORDS):
        reasons.append("Urgency / pressure language detected")
    if any(w in t for w in CREDENTIAL_WORDS):
        reasons.append("Requests OTP / password / verification code")
    if any(w in t for w in MONEY_WORDS):
        reasons.append("Money or prize promises")
    if any(w in t for w in LINK_WORDS):
        reasons.append("Contains suspicious link or shortener")
    return reasons


def _map_verdict(score: float) -> str:
    if score < SAFE_THRESHOLD:
        return "Safe"
    if score < PHISHING_THRESHOLD:
        return "Suspicious"
    return "Phishing"


class ScamSensePredictor:
    def __init__(self) -> None:
        self._loaded = False
        self.url_model = None
        self.msg_model = None
        self.vectorizer = None
        self.url_explainer = None
        self.msg_explainer = None
        self.msg_feature_names: list[str] = []

    def ensure_ready(self) -> None:
        if self._loaded:
            return
        url_path = MODEL_DIR / "url_model.joblib"
        msg_path = MODEL_DIR / "message_model.joblib"
        if not url_path.exists() or not msg_path.exists():
            print("[ScamSense] Training models on first startup...")
            train_models_now()
        url_bundle = joblib.load(url_path)
        msg_bundle = joblib.load(msg_path)
        self.url_model = url_bundle["model"]
        self.msg_model = msg_bundle["model"]
        self.vectorizer = msg_bundle["vectorizer"]
        self.msg_feature_names = list(self.vectorizer.get_feature_names_out())
        # SHAP explainers - TreeExplainer is fast for RandomForest
        self.url_explainer = shap.TreeExplainer(self.url_model)
        self.msg_explainer = shap.TreeExplainer(self.msg_model)
        self._loaded = True
        print("[ScamSense] Models loaded and explainers ready.")

    # ---------- URL analysis ----------
    def _url_prob_and_reasons(self, url: str) -> tuple[float, list[str], list[dict]]:
        if not (url or "").strip():
            return 0.0, [], []
        feats = np.array([extract_url_features(url)], dtype=float)
        prob = float(self.url_model.predict_proba(feats)[0, 1])

        # SHAP contribution for class=1 (phishing) — always compute for explanation
        shap_vals = self.url_explainer.shap_values(feats)
        contribs = self._extract_positive_class(shap_vals)[0]  # shape: (n_features,)

        # Build SHAP feature contributions list (top positive contributors)
        order = np.argsort(-contribs)
        shap_features: list[dict] = []
        for idx in order:
            if contribs[idx] <= 0:
                break
            shap_features.append({
                "feature": URL_FEATURE_NAMES[idx],
                "value": float(feats[0, idx]),
                "contribution": round(float(contribs[idx]), 4),
            })
            if len(shap_features) >= TOP_K_REASONS:
                break

        if prob < SAFE_THRESHOLD:
            return prob, [], shap_features

        reasons: list[str] = []
        for sf in shap_features:
            r = _url_reason_for_feature(sf["feature"], sf["value"])
            if r and r not in reasons:
                reasons.append(r)
            if len(reasons) >= TOP_K_REASONS:
                break
        # Fallback if no strong signals
        if not reasons and prob >= SAFE_THRESHOLD:
            reasons = ["Suspicious URL patterns detected"]
        return prob, reasons, shap_features

    # ---------- Message analysis ----------
    def _message_prob_and_reasons(self, message: str) -> tuple[float, list[str], list[dict]]:
        if not (message or "").strip():
            return 0.0, [], []
        vec = self.vectorizer.transform([message or ""]).toarray()
        prob = float(self.msg_model.predict_proba(vec)[0, 1])

        semantic = _message_semantic_reasons(message)

        # SHAP contribution — always compute for explanation
        shap_vals = self.msg_explainer.shap_values(vec)
        contribs = self._extract_positive_class(shap_vals)[0]

        order = np.argsort(-contribs)
        shap_features: list[dict] = []
        for idx in order:
            if contribs[idx] <= 0:
                break
            token = self.msg_feature_names[idx]
            if vec[0, idx] == 0:
                continue
            shap_features.append({
                "feature": token,
                "value": int(vec[0, idx]),
                "contribution": round(float(contribs[idx]), 4),
            })
            if len(shap_features) >= TOP_K_REASONS:
                break

        if prob < SAFE_THRESHOLD and not semantic:
            return prob, [], shap_features

        if len(semantic) >= TOP_K_REASONS:
            return prob, semantic[:TOP_K_REASONS], shap_features

        # Top SHAP tokens for elevated risk or semantic matches
        for sf in shap_features:
            reason = f"Suspicious phrase: '{sf['feature']}'"
            if reason not in semantic:
                semantic.append(reason)
            if len(semantic) >= TOP_K_REASONS:
                break
        return prob, semantic, shap_features

    @staticmethod
    def _extract_positive_class(shap_vals: Any) -> np.ndarray:
        # shap returns list-of-arrays (per class) for classifiers in older versions,
        # or a 3-D array (n, features, classes) in newer versions.
        if isinstance(shap_vals, list):
            return np.array(shap_vals[1])
        arr = np.array(shap_vals)
        if arr.ndim == 3:
            return arr[:, :, 1]
        return arr

    @staticmethod
    def _compute_risk_and_verdict(
        url_prob: float, msg_prob: float, has_url: bool, has_msg: bool,
    ) -> tuple[float, str]:
        if has_url and has_msg:
            risk = URL_WEIGHT * url_prob + MESSAGE_WEIGHT * msg_prob
        elif has_url:
            risk = url_prob
        else:
            risk = msg_prob
        return risk, _map_verdict(risk)

    # ---------- Public API ----------
    def predict(self, url: str, message: str) -> dict:
        self.ensure_ready()
        url_prob, url_reasons, url_shap = self._url_prob_and_reasons(url)
        msg_prob, msg_reasons, msg_shap = self._message_prob_and_reasons(message)

        has_url = bool((url or "").strip())
        has_msg = bool((message or "").strip())

        # Whitelist override: if the URL domain is a known trusted domain,
        # cap the URL contribution at safe level regardless of path keywords.
        if has_url:
            reg_domain = _get_registered_domain(url)
            if reg_domain in KNOWN_SAFE_DOMAINS:
                url_prob = min(url_prob, SAFE_THRESHOLD - 0.01)
                url_reasons = []

        risk, verdict = self._compute_risk_and_verdict(url_prob, msg_prob, has_url, has_msg)
        if not has_url:
            url_reasons = []
            url_shap = []
        if not has_msg:
            msg_reasons = []
            msg_shap = []

        return {
            "risk_score": round(risk, 4),
            "verdict": verdict,
            "url_reasons": url_reasons,
            "message_reasons": msg_reasons,
            "recommendation": RECOMMENDATIONS[verdict],
            "url_probability": round(url_prob, 4),
            "message_probability": round(msg_prob, 4),
            "url_shap_features": url_shap,
            "message_shap_features": msg_shap,
            "thresholds": {
                "safe": SAFE_THRESHOLD,
                "phishing": PHISHING_THRESHOLD,
            },
        }


predictor = ScamSensePredictor()

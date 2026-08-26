"""
Train the URL and Message models used by ScamSense.

  - URL model : Enriched synthetic corpus with realistic phishing and
                legitimate URL patterns. Feature extraction uses 13
                hand-crafted signals.
  - Message   : UCI SMS Spam Collection (tab-separated) via a public GitHub
                mirror (justmarkham/pycon-2016-tutorial).

Fallback: if the network is unavailable, an enriched synthetic corpus is used
so the server can still train and start.

Run:  python train_models.py
Outputs saved to:  <backend>/models/
"""
from __future__ import annotations

import io
import math
import os
import re
import random
import logging
from pathlib import Path
from typing import Tuple
from urllib.parse import urlparse

import joblib
import numpy as np
import pandas as pd
import requests
from sklearn.ensemble import RandomForestClassifier
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.model_selection import train_test_split
from sklearn.metrics import (
    accuracy_score, classification_report, roc_auc_score
)

logger = logging.getLogger("scamsense.train")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

MODEL_DIR = Path(__file__).parent / "models"
DATA_DIR  = Path(__file__).parent / "data"
MODEL_DIR.mkdir(parents=True, exist_ok=True)
DATA_DIR.mkdir(parents=True, exist_ok=True)

RNG = random.Random(42)
np.random.seed(42)

# ─────────────────────────────────────────────────────────────────────────────
# URL FEATURE EXTRACTION  (predictor.py imports from here)
# ─────────────────────────────────────────────────────────────────────────────
SUSPICIOUS_URL_KEYWORDS = [
    "login", "verify", "update", "secure", "account", "bank", "confirm",
    "signin", "wallet", "webscr", "password", "otp", "gift", "prize",
    "bonus", "urgent", "invoice", "support",
]
IP_RE = re.compile(r"^https?://(?:\d{1,3}\.){3}\d{1,3}(?:[:/]|$)")

SUSPICIOUS_TLDS = {
    "xyz", "top", "click", "tk", "gq", "ml", "pw", "ru", "cn",
    "buzz", "club", "online", "site", "website", "space", "party",
    "work", "win", "loan", "download", "link", "bid", "trade", "stream",
}

URL_SHORTENERS = {
    "bit.ly", "tinyurl.com", "goo.gl", "t.co", "is.gd", "buff.ly",
    "ow.ly", "short.io", "rebrand.ly", "cutt.ly", "tiny.cc",
    "shorturl.at", "clck.ru", "bl.ink", "v.gd", "rb.gy",
}

# Curated whitelist: global + Indian banking/fintech/govt/ecommerce
KNOWN_SAFE_DOMAINS = {
    # Global tech
    "google.com", "youtube.com", "gmail.com", "googlemail.com",
    "github.com", "wikipedia.org", "stackoverflow.com",
    "microsoft.com", "apple.com", "amazon.com", "amazon.in",
    "netflix.com", "linkedin.com", "twitter.com", "x.com",
    "facebook.com", "instagram.com", "whatsapp.com",
    "reddit.com", "medium.com", "cloudflare.com",
    "python.org", "mozilla.org", "openai.com",
    "dropbox.com", "notion.so", "figma.com", "stripe.com",
    "zoom.us", "slack.com", "salesforce.com", "adobe.com",
    "spotify.com", "twitch.tv", "bing.com", "yahoo.com",
    "duckduckgo.com", "bbc.com", "bbc.co.uk", "cnn.com",
    "nytimes.com", "theguardian.com", "reuters.com",
    "techcrunch.com", "forbes.com", "bloomberg.com",
    "harvard.edu", "mit.edu", "stanford.edu",
    "coursera.org", "udemy.com", "edx.org",
    "nasa.gov", "cdc.gov", "who.int",
    "paypal.com", "visa.com", "mastercard.com",
    "npr.org", "zoom.us", "notion.so",
    # Indian banking
    "onlinesbi.sbi", "sbi.co.in", "sbionline.com",
    "hdfcbank.com", "netbanking.hdfcbank.com",
    "icicibank.com", "infinityicici.com",
    "axisbank.com", "axisnet.in",
    "bankofbaroda.in", "bankofbaroda.com", "bankofbaroda.co.in",
    "pnbindia.in", "netpnb.com",
    "kotak.com", "kotakbank.com",
    "yesbank.in", "indusind.com",
    "canarabank.com", "canarabank.in",
    "unionbankofindia.co.in", "unionbankonline.co.in",
    "centralbankofindia.co.in", "idbibank.in",
    "bandhanbank.com", "rblbank.com",
    "federalbank.co.in", "southindianbank.com",
    "idfcfirstbank.com", "aubank.in",
    # Indian fintech
    "paytm.com", "phonepe.com", "gpay.app", "googlepay.com",
    "mobikwik.com", "razorpay.com", "cashfree.com",
    "groww.in", "zerodha.com", "angelone.in",
    "policybazaar.com", "coverfox.com",
    "bajajfinserv.in", "loanfront.in",
    "bharatpay.com", "bhim.npci.org.in",
    "freecharge.in", "olamoney.com",
    "cred.club", "jupiter.money",
    # Indian government
    "gov.in", "nic.in", "india.gov.in",
    "uidai.gov.in", "aadhaar.gov.in",
    "irctc.co.in", "indianrail.gov.in",
    "incometax.gov.in", "efiling.incometaxindia.gov.in",
    "digilocker.gov.in", "digitallocker.gov.in",
    "npci.org.in", "rbi.org.in",
    "sebi.gov.in", "mca.gov.in",
    "epfindia.gov.in", "passport.gov.in",
    "nta.ac.in", "ssc.nic.in", "ibps.in",
    "cowin.gov.in", "nhp.gov.in",
    # Indian ecommerce / food / travel
    "flipkart.com", "myntra.com", "meesho.com",
    "snapdeal.com", "nykaa.com", "ajio.com",
    "zomato.com", "swiggy.com", "blinkit.com",
    "makemytrip.com", "goibibo.com", "cleartrip.com",
    "yatra.com", "ixigo.com",
    "indigo.in", "airindia.in", "spicejet.com",
    "tataneu.com", "jiomart.com", "bigbasket.com",
    "1mg.com", "netmeds.com", "pharmeasy.in",
    # Indian telecom / media
    "jio.com", "airtel.in", "bsnl.co.in",
    "vi.in", "vodafone.in",
    "ndtv.com", "timesofindia.com", "hindustantimes.com",
    "thehindu.com", "indianexpress.com", "moneycontrol.com",
    "livemint.com",
}

URL_FEATURE_NAMES = [
    "url_length",
    "dot_count",
    "special_char_count",
    "has_ip",
    "has_https",
    "suspicious_keyword_count",
    "tld_suspicious",
    "subdomain_depth",
    "is_known_safe_domain",
    "has_url_shortener",
    "url_entropy",
    "has_at_symbol",
    "path_depth",
]

# Two-part TLDs (e.g. co.in, gov.in)
_TWO_PART_TLDS = {
    "co.in", "gov.in", "ac.in", "net.in", "org.in", "co.uk",
    "org.uk", "ac.uk", "net.uk", "com.au", "co.au", "co.nz",
}


def _get_registered_domain(url: str) -> str:
    """Extract registered domain (e.g. accounts.google.com -> google.com)."""
    try:
        host = urlparse(url).netloc.split(":")[0].lower()
        parts = host.split(".")
        if len(parts) >= 3 and ".".join(parts[-2:]) in _TWO_PART_TLDS:
            return ".".join(parts[-3:])
        if len(parts) >= 2:
            return ".".join(parts[-2:])
        return host
    except Exception:
        return ""


def _url_entropy(url: str) -> float:
    """Shannon entropy of URL string. High = random-looking (phishing)."""
    if not url:
        return 0.0
    freq: dict[str, int] = {}
    for c in url:
        freq[c] = freq.get(c, 0) + 1
    n = len(url)
    return -sum((f / n) * math.log2(f / n) for f in freq.values())


def extract_url_features(url: str) -> list[float]:
    u = (url or "").strip()
    if not u:
        return [0.0] * len(URL_FEATURE_NAMES)

    # --- Original 6 features ---
    special = sum(1 for c in u if c in "-_@?=&%#~")
    has_ip = 1 if IP_RE.match(u) else 0
    has_https = 1 if u.lower().startswith("https://") else 0
    kw = sum(1 for k in SUSPICIOUS_URL_KEYWORDS if k in u.lower())

    # --- Parse host / path ---
    try:
        parsed = urlparse(u)
        host = parsed.netloc.split(":")[0].lower()
        path = parsed.path
    except Exception:
        host, path = "", ""

    # --- New features ---
    tld = host.split(".")[-1] if "." in host else ""
    tld_suspicious = 1 if tld in SUSPICIOUS_TLDS else 0

    reg_domain = _get_registered_domain(u)
    subdomain_part = host[: -len(reg_domain)].rstrip(".") if reg_domain and host.endswith(reg_domain) else ""
    subdomain_depth = subdomain_part.count(".") + (1 if subdomain_part else 0)

    is_known_safe = 1 if reg_domain in KNOWN_SAFE_DOMAINS else 0
    has_shortener = 1 if reg_domain in URL_SHORTENERS else 0
    entropy = _url_entropy(u)
    has_at = 1 if "@" in u else 0
    path_depth = len([p for p in path.split("/") if p]) if path else 0

    return [
        len(u), u.count("."), special, has_ip, has_https, kw,
        tld_suspicious, subdomain_depth, is_known_safe, has_shortener,
        entropy, has_at, path_depth,
    ]


# ─────────────────────────────────────────────────────────────────────────────
# DATASET DOWNLOAD HELPERS
# ─────────────────────────────────────────────────────────────────────────────
_TIMEOUT = 20  # seconds per HTTP request


def _fetch(url: str, local: Path) -> bytes | None:
    """Download `url` to `local` (cached).  Returns bytes or None on failure."""
    if local.exists():
        logger.info("Using cached %s", local.name)
        return local.read_bytes()
    try:
        logger.info("Downloading %s …", url)
        r = requests.get(url, timeout=_TIMEOUT)
        r.raise_for_status()
        local.write_bytes(r.content)
        logger.info("Saved %s (%d bytes)", local.name, len(r.content))
        return r.content
    except Exception as exc:
        logger.warning("Download failed (%s): %s", url, exc)
        return None


def load_url_dataset() -> Tuple[np.ndarray, np.ndarray]:
    """
    Returns (X, y) for the URL model using exact feature extraction.
    """
    logger.info("Using enriched URL dataset with exact feature extraction")
    return _synthetic_url_dataset(n_per_class=2000)


# ─────────────────────────────────────────────────────────────────────────────
# MESSAGE DATASET — UCI SMS Spam Collection  (public domain)
# Tab-separated: label ∈ {ham, spam}  |  message text
# ─────────────────────────────────────────────────────────────────────────────
_SMS_DATASET_URL = (
    "https://raw.githubusercontent.com/justmarkham/"
    "pycon-2016-tutorial/master/data/sms.tsv"
)
_SMS_CACHE = DATA_DIR / "sms_spam_collection.tsv"


def load_message_dataset() -> Tuple[list[str], np.ndarray]:
    """
    Returns (texts, y) for the message model.

    Primary  → UCI SMS Spam Collection (5 572 real SMS messages)
    Fallback → enriched synthetic corpus
    """
    raw = _fetch(_SMS_DATASET_URL, _SMS_CACHE)
    if raw is not None:
        try:
            df = pd.read_csv(
                io.BytesIO(raw),
                sep="\t",
                names=["label", "message"],
                header=None,
            )
            df = df.dropna()
            y = (df["label"].str.strip().str.lower() == "spam").astype(int).values
            texts = df["message"].tolist()
            total = len(y)
            pos   = y.sum()
            logger.info(
                "SMS dataset loaded: %d rows (%d spam / %d ham)",
                total, pos, total - pos,
            )
            return texts, y
        except Exception as exc:
            logger.warning("Failed to parse SMS dataset: %s — falling back to synthetic", exc)

    logger.info("Using synthetic message dataset (network unavailable)")
    return _synthetic_message_dataset()


# ─────────────────────────────────────────────────────────────────────────────
# ENRICHED SYNTHETIC FALLBACKS
# Substantially larger & more varied than the original 18/18-sample sets.
# ─────────────────────────────────────────────────────────────────────────────
_LEGIT_DOMAINS = [
    "google.com", "wikipedia.org", "github.com", "stackoverflow.com",
    "microsoft.com", "apple.com", "amazon.com", "netflix.com",
    "linkedin.com", "youtube.com", "nytimes.com", "bbc.co.uk",
    "cloudflare.com", "python.org", "mozilla.org", "nasa.gov",
    "openai.com", "reddit.com", "medium.com", "coursera.org",
    "harvard.edu", "mit.edu", "stanford.edu", "cnn.com", "bbc.com",
    "forbes.com", "techcrunch.com", "theguardian.com", "npr.org",
    "zoom.us", "dropbox.com", "notion.so", "figma.com", "stripe.com",
]
_LEGIT_PATHS = [
    "", "/home", "/about", "/pricing", "/docs", "/blog/post-1",
    "/contact", "/help", "/faq", "/news", "/search", "/products",
    "/features", "/team", "/careers", "/terms", "/privacy",
]
_PHISH_HOSTS = [
    "secure-{d}-login.{tld}", "{d}-verify-account.{tld}", "update-{d}.{tld}",
    "{d}.support-help.{tld}", "signin-{d}.{tld}", "{d}account-verify.{tld}",
    "{d}-secure-access.{tld}", "alert-{d}-account.{tld}", "{d}-billing.{tld}",
]
_PHISH_TLDS   = ["xyz", "top", "click", "info", "ru", "cn", "tk", "gq", "ml", "pw"]
_PHISH_PATHS  = [
    "/login?redirect=verify", "/wallet/confirm-otp", "/reset-password?token=abcd",
    "/verify?user=1", "/secure/login.php", "/account/update", "/prize/claim",
    "/gift-card/verify", "/otp?next=banking", "/invoice/pay-now",
]


def _rand_ip() -> str:
    return ".".join(str(RNG.randint(1, 254)) for _ in range(4))


def _synthetic_url_dataset(n_per_class: int = 1200):
    X, y = [], []
    for _ in range(n_per_class):
        dom  = RNG.choice(_LEGIT_DOMAINS)
        path = RNG.choice(_LEGIT_PATHS)
        scheme = "https://" if RNG.random() < 0.92 else "http://"
        X.append(extract_url_features(f"{scheme}{dom}{path}"))
        y.append(0)
    for _ in range(n_per_class):
        base = RNG.choice(_LEGIT_DOMAINS).split(".")[0]
        if RNG.random() < 0.15:
            host = _rand_ip()
        else:
            tpl  = RNG.choice(_PHISH_HOSTS)
            host = tpl.format(d=base, tld=RNG.choice(_PHISH_TLDS))
        path   = RNG.choice(_PHISH_PATHS)
        scheme = "http://" if RNG.random() < 0.7 else "https://"
        X.append(extract_url_features(f"{scheme}{host}{path}"))
        y.append(1)
    return np.array(X), np.array(y)


_LEGIT_MESSAGES = [
    # --- General / English ---
    "Hey, are we still meeting for coffee tomorrow at 10?",
    "Reminder: your dentist appointment is scheduled for Friday.",
    "Thanks for the report. I'll review it tonight and get back to you.",
    "Happy birthday! Hope you have an amazing day.",
    "The team standup has been moved to 3pm today.",
    "Can you send me the presentation slides when you get a chance?",
    "Package delivered. Left at your front door.",
    "Great job on the launch, team. Really proud of everyone.",
    "Let's grab lunch next week. Wednesday works for me.",
    "The board meeting notes are attached for your review.",
    "Your monthly newsletter from the community garden.",
    "Flight confirmation: departure Monday 8:30 AM.",
    "See you at the concert on Saturday!",
    "Attaching the invoice for last month's consulting work.",
    "The library book you reserved is ready for pickup.",
    "Sprint retro moved to Thursday 4pm.",
    "Enjoy the weekend! Talk on Monday.",
    "Thanks for the introduction, I'll reach out to them directly.",
    "Hi, just checking in. Hope everything is going well.",
    "The meeting agenda has been updated. Please review before Thursday.",
    "Your parcel has been shipped. Expected delivery: 3 days.",
    "Don't forget to submit your timesheet by end of day.",
    "Movie night at mine on Friday? Bring snacks!",
    "The project is on track. No blockers this week.",
    "Can you review my PR when you get a moment?",
    # --- Indian legitimate messages ---
    "Rs.5000 credited to your A/c XX1234 on 05-Aug-26 by UPI. Avl Bal: Rs.12345. -HDFC Bank",
    "Your SBI OTP for login is 847293. Valid for 10 minutes. Do NOT share with anyone. -SBI",
    "Your IRCTC ticket is confirmed. PNR: 4123456789. Train: 12345 RAJDHANI EXP. Dep: 10-Aug-26 06:00.",
    "Your Zomato order from Domino's Pizza is confirmed. Estimated delivery: 35 mins. -Zomato",
    "Aadhaar OTP: 512847. Use this to authenticate your Aadhaar transaction. Do NOT share. -UIDAI",
    "Your Jio postpaid bill of Rs.499 is due on 15-Aug-26. Pay at jio.com or Jio app. -Jio",
    "Your EPF balance as on Jul-26 is Rs.1,23,456. View details on EPFO member portal. -EPFO",
    "Your DigiLocker Driving Licence has been issued by MoRTH. View at digilocker.gov.in. -DigiLocker",
    "Your Swiggy order is out for delivery. Estimated arrival: 10 mins. -Swiggy",
    "Your Flipkart order #FK987654 has been shipped. Expected delivery: 3-Aug-26. -Flipkart",
    "Your PhonePe UPI payment of Rs.250 to Grocery Store is successful. Ref: 12345678. -PhonePe",
    "Income Tax Refund of Rs.4500 has been credited to your account. View at incometax.gov.in. -ITD",
    "Your Paytm wallet has been loaded with Rs.1000. Available balance: Rs.1250. -Paytm",
    "Your Groww SIP of Rs.500 in XYZ Fund has been processed for Aug 2026. -Groww",
    "Booking confirmed! Hotel Taj, Mumbai. Check-in: 12-Aug-26. Booking ID: MMT12345. -MakeMyTrip",
    "Your Ola ride is on the way. Driver: Ramesh, KA01AB1234. ETA: 4 mins. -Ola",
    "Your prescription from Apollo Pharmacy has been dispatched. Delivery by tomorrow. -Apollo",
    "PNB: A/c XX5678 debited Rs.2000 on 05-Aug-26 via ATM. Avl Bal: Rs.8500. -PNB",
    "Your Amazon order has been delivered. Thank you for shopping with us. -Amazon India",
    "BSNL: Your broadband plan renewed successfully. Validity: 30 days. -BSNL",
    "Your Aadhaar update request has been submitted. Track at uidai.gov.in. -UIDAI",
    "Maa, main ghar pahunch gaya. Raat ko call karta hoon.",
    "Office se late ho raha hoon. Dinner mat wait karo. -Rahul",
    "Your income tax return for AY 2026-27 has been e-verified successfully. -ITD",
    "Dear student, your NEET 2026 admit card is available at nta.ac.in. -NTA",
]
_SCAM_MESSAGES = [
    # --- General / English scams ---
    "URGENT: Your account will be suspended. Click this link now to verify: bit.ly/xyz",
    "Congratulations! You have WON a free iPhone. Claim your prize now: http://prize.win/claim",
    "Bank alert: suspicious activity. Verify your password immediately at secure-bank.xyz",
    "Final notice: unpaid invoice. Pay now to avoid legal action: pay.now/invoice",
    "You have inherited $5,000,000 USD. Send your bank details to claim.",
    "URGENT act now! Limited offer, click http://freegift.top to claim your bonus.",
    "Amazon: your package couldn't be delivered. Update address here: amzn-delivery.click",
    "IRS FINAL WARNING - pay tax immediately or face arrest. Call now.",
    "Your Netflix subscription is on hold. Update payment info urgently: netflix-billing.info",
    "Security alert! Someone tried to sign in. Confirm identity: verify-login.xyz",
    "You've been selected! Send $50 processing fee to receive $10,000 prize.",
    "PAYPAL: unusual login. Reset your password here immediately or lose access.",
    "Dear user, kindly send your credit card number to reactivate account.",
    "Alert! Click this link to verify your wallet or funds will be frozen.",
    "Congratulations winner! Provide OTP to claim your reward now.",
    "URGENT: your password expires today. Enter it here to keep account active.",
    "Special promo just for you - send bank OTP to receive gift card instantly.",
    "FREE entry into our prize draw! Click here now: freeprize.tk/enter",
    "You are a winner! Call +1-800-WIN-NOW to claim $500 reward immediately.",
    "Hello dear, I am a barrister contacting you regarding unclaimed funds of $4M.",
    "Your delivery failed. Pay $1.99 redelivery fee: delivery-rebook.click",
    "ALERT: Unauthorized access detected. Secure your wallet NOW: walletprotect.top",
    "Airdrop! Claim free crypto. Connect wallet at airdropnow.xyz/claim",
    # --- Indian banking scams ---
    "Dear SBI customer, your account is blocked due to incomplete KYC. Visit http://sbi-kyc-update.xyz immediately.",
    "HDFC Bank: Your credit card is blocked. Share CVV to restore: http://hdfc-secure.top/unblock",
    "Your ICICI account will be deactivated. Update KYC now: http://icici-kyc-verify.click",
    "Axis Bank Alert: Suspicious login detected. Confirm password at http://axisbank-verify.xyz",
    "Bank of Baroda: Your net banking is suspended. Re-activate at http://bob-netbanking.top",
    "Dear customer, your PNB account has been blocked. Share OTP to unblock now.",
    "Kotak 811 Alert: Rs.49,999 transaction attempted. Call 9999XXXX or share OTP to cancel.",
    # --- Indian fintech scams ---
    "PhonePe: Your wallet is locked. Click http://phonepe-kyc.xyz to complete KYC and unlock.",
    "Paytm: Your KYC is pending. Account will be suspended in 24 hours. Verify: http://paytm-kyc.top",
    "Your Groww account is flagged. Provide Aadhaar OTP to continue investing: http://groww-verify.xyz",
    "Congratulations! You won Rs.50,000 in Paytm Lucky Draw. Share your UPI PIN to claim now.",
    "GPay: Unusual transaction blocked. Verify your identity at http://gpay-secure.top now.",
    # --- Government impersonation scams ---
    "Your Aadhaar card is linked to 3 illegal bank accounts. Call CBI officer at 9876543210 immediately.",
    "TRAI: Your mobile number will be disconnected in 2 hours for illegal activity. Press 1 to speak with officer.",
    "Income Tax Dept: Rs.14,500 refund pending. Share bank account and OTP to process: http://itrefund.xyz",
    "Police Cyber Cell: A case is registered against your Aadhaar. Pay Rs.5000 fine to avoid arrest.",
    "PM Modi Government Lottery 2026: You won Rs.25 Lakh! Call 9000100001 to claim prize.",
    "EPFO: Your PF withdrawal request needs verification. Share OTP sent to your number.",
    "Your driving licence is linked to a criminal case. Pay Rs.3000 at http://rto-penalty.xyz to resolve.",
    # --- Delivery and ecommerce scams ---
    "Flipkart: Your order delivery failed. Pay Rs.49 redelivery fee: http://flipkart-redeliver.click",
    "Amazon: Package held at customs. Pay Rs.199 clearance fee: http://amazon-customs.xyz",
    "India Post: Your parcel is on hold. Update address at http://indiapost-delivery.top within 24 hours.",
    "Your Meesho package returned to warehouse. Pay Rs.99 to reship: http://meesho-reship.xyz",
    # --- Job and lottery scams ---
    "Congratulations! You are selected for Govt job. Send Rs.2000 processing fee to confirm offer letter.",
    "DRDO/ISRO recruitment 2026: Apply now at http://drdo-jobs.xyz. Last date tomorrow! Fee: Rs.500.",
    "You have won a plot in PM Housing Scheme. Register at http://pm-awas-claim.top by paying Rs.999.",
    # --- Crypto and investment scams ---
    "Earn Rs.5000/day from home! Join our WhatsApp group for free trading tips. Limited seats.",
    "Crypto Airdrop: Connect your MetaMask wallet at http://airdrop-eth.xyz to claim 0.5 ETH free.",
    "Invest Rs.10,000 and earn Rs.50,000 in 7 days guaranteed! Call 9876XXXXXX now.",
    "Your Binance account requires KYC update. Submit documents at http://binance-kyc.xyz immediately.",
]


def _synthetic_message_dataset(n_per_class: int = 600):
    texts, labels = [], []
    for _ in range(n_per_class):
        texts.append(RNG.choice(_LEGIT_MESSAGES))
        labels.append(0)
    for _ in range(n_per_class):
        texts.append(RNG.choice(_SCAM_MESSAGES))
        labels.append(1)
    return texts, np.array(labels)


# ─────────────────────────────────────────────────────────────────────────────
# TRAINING
# ─────────────────────────────────────────────────────────────────────────────
def train() -> None:
    # ── URL model ────────────────────────────────────────────────────────────
    logger.info("=== Training URL model ===")
    Xu, yu = load_url_dataset()
    Xu_tr, Xu_te, yu_tr, yu_te = train_test_split(
        Xu, yu, test_size=0.2, random_state=42, stratify=yu
    )
    url_model = RandomForestClassifier(
        n_estimators=200, max_depth=12, min_samples_leaf=2,
        random_state=42, n_jobs=-1, class_weight="balanced",
    )
    url_model.fit(Xu_tr, yu_tr)
    yu_pred = url_model.predict(Xu_te)
    url_acc = accuracy_score(yu_te, yu_pred)
    url_auc = roc_auc_score(yu_te, url_model.predict_proba(Xu_te)[:, 1])
    logger.info("URL model  — Accuracy: %.4f  |  AUC-ROC: %.4f", url_acc, url_auc)
    logger.info("\n%s", classification_report(yu_te, yu_pred, target_names=["Legit", "Phishing"]))

    # ── Message model ────────────────────────────────────────────────────────
    logger.info("=== Training Message model ===")
    texts, ym = load_message_dataset()
    vec = TfidfVectorizer(
        lowercase=True, ngram_range=(1, 2),
        min_df=2, max_features=5000, sublinear_tf=True,
    )
    Xm = vec.fit_transform(texts).toarray()
    Xm_tr, Xm_te, ym_tr, ym_te = train_test_split(
        Xm, ym, test_size=0.2, random_state=42, stratify=ym
    )
    msg_model = RandomForestClassifier(
        n_estimators=200, max_depth=15, min_samples_leaf=1,
        random_state=42, n_jobs=-1, class_weight="balanced",
    )
    msg_model.fit(Xm_tr, ym_tr)
    ym_pred = msg_model.predict(Xm_te)
    msg_acc = accuracy_score(ym_te, ym_pred)
    msg_auc = roc_auc_score(ym_te, msg_model.predict_proba(Xm_te)[:, 1])
    logger.info("Message model — Accuracy: %.4f  |  AUC-ROC: %.4f", msg_acc, msg_auc)
    logger.info("\n%s", classification_report(ym_te, ym_pred, target_names=["Ham", "Spam"]))

    # ── Persist ──────────────────────────────────────────────────────────────
    joblib.dump(
        {"model": url_model, "feature_names": URL_FEATURE_NAMES},
        MODEL_DIR / "url_model.joblib",
    )
    joblib.dump(
        {"model": msg_model, "vectorizer": vec},
        MODEL_DIR / "message_model.joblib",
    )
    logger.info("Models saved to %s", MODEL_DIR)
    logger.info(
        "Summary → URL acc: %.2f%% | AUC: %.4f  |  "
        "MSG acc: %.2f%% | AUC: %.4f",
        url_acc * 100, url_auc, msg_acc * 100, msg_auc,
    )


if __name__ == "__main__":
    train()

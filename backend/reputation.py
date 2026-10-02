"""
Domain Reputation Analysis for ScamSense.

This runs *after* the trained models. The RandomForest scores the URL on its 13
static features, then this module asks a small set of independent sources what
they think about the domain, and returns a bounded set of weighted signals.

Design rule: reputation can only ever *raise* risk, never lower it, and the
total raise is capped. One source saying "bad" must never be able to declare a
domain malicious on its own -- the ML model stays the primary evidence, which
is what makes the result defensible rather than dependent on a live feed.

    13 URL features --> RandomForest --> ML score -----+
                                                        |
    RDAP / DNS / Safe Browsing / VirusTotal / OpenPhish +--> Risk engine
                                                                      |
                                                            final score (capped)
                                                                      |
                                                             verdict + reasons

Every provider is optional and independently fails soft: no API key, a network
error, or an unsupported TLD degrades that one source to "unavailable" and
leaves the rest of the analysis intact.
"""
from __future__ import annotations

import ipaddress
import os
import socket
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

import requests

from train_models import _get_registered_domain

# ---------- Tunable contributions, in risk points out of 100 ----------
#
# Kept as literal point values (not fractions) so the report can quote the same
# table that the code uses.
POINTS_KNOWN_MALICIOUS = 20.0   # on an authoritative blocklist
POINTS_NO_DNS = 10.0            # the domain does not resolve at all
POINTS_MULTI_ENGINE = 10.0      # several independent engines flag it
POINTS_NEW_DOMAIN = 5.0         # registered very recently
POINTS_SUSPICIOUS_REDIRECT = 5.0

# The sum of every possible signal is 50, but the bump is capped lower so that
# reputation alone can never manufacture a confident verdict. 40 points can
# promote a borderline "Suspicious" to "Phishing", but cannot promote a clean
# 0.05 to Phishing on its own.
MAX_REPUTATION_BUMP = 0.40

NEW_DOMAIN_DAYS = 30
MULTI_ENGINE_THRESHOLD = 3
SUSPICIOUS_REDIRECT_HOPS = 3

# Per-request timeouts. Kept short: a slow third party must never make a scan
# feel broken.
HTTP_TIMEOUT = 7.0

_USER_AGENT = "ScamSense/1.0 (educational phishing detector; +localhost)"

# Cached lookups, so scanning the same domain repeatedly is cheap and does not
# burn a rate-limited API key.
_CACHE: dict[str, tuple[float, Any]] = {}
_CACHE_TTL = 300.0
_cache_lock = threading.Lock()


def _cached(key: str, ttl: float, producer):
    now = time.time()
    with _cache_lock:
        hit = _CACHE.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
    value = producer()
    with _cache_lock:
        if len(_CACHE) > 400:
            _CACHE.clear()
        _CACHE[key] = (time.time(), value)
    return value


# ---------- Result shapes ----------
@dataclass
class Signal:
    """One piece of reputation evidence and what it is worth."""
    key: str
    label: str              # plain-language reason, reused by the reason list
    points: float
    source: str             # which provider produced it
    detail: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {
            "key": self.key,
            "label": self.label,
            "points": self.points,
            "source": self.source,
            "detail": self.detail,
        }


@dataclass
class ReputationResult:
    domain: str = ""
    available: bool = False       # did any provider actually answer?
    signals: list[Signal] = field(default_factory=list)
    bump: float = 0.0             # capped, 0..MAX_REPUTATION_BUMP
    providers: dict = field(default_factory=dict)   # raw data for the UI panel
    notes: list[str] = field(default_factory=list)

    def reasons(self) -> list[str]:
        return [s.label for s in self.signals]

    def as_dict(self) -> dict:
        return {
            "domain": self.domain,
            "available": self.available,
            "bump": round(self.bump, 4),
            "max_bump": MAX_REPUTATION_BUMP,
            "signals": [s.as_dict() for s in self.signals],
            "providers": self.providers,
            "notes": self.notes,
        }


EMPTY = ReputationResult()


# ---------- Helpers ----------
def _is_public_ip(ip: str) -> bool:
    """Reject private/loopback/link-local targets.

    The redirect check makes the server fetch a user-supplied URL, so without
    this an attacker could point a scan at 127.0.0.1 or a cloud metadata
    endpoint and use this API as a request proxy.
    """
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return not (
        addr.is_private or addr.is_loopback or addr.is_link_local
        or addr.is_multicast or addr.is_reserved or addr.is_unspecified
    )


def _resolve_ips(host: str) -> list[str]:
    try:
        infos = socket.getaddrinfo(host, None)
    except Exception:
        return []
    seen, out = set(), []
    for info in infos:
        ip = info[4][0]
        if ip not in seen:
            seen.add(ip)
            out.append(ip)
    return out


def _registered_domain(url: str) -> str:
    if not url:
        return ""
    if "://" not in url:
        url = "http://" + url
    return _get_registered_domain(url)


# ---------- Providers ----------
def check_dns(domain: str) -> dict:
    """Does the domain resolve, and to public addresses only?"""
    def produce() -> dict:
        ips = _resolve_ips(domain)
        public = [ip for ip in ips if _is_public_ip(ip)]
        return {
            "status": "resolves" if public else ("private_only" if ips else "no_dns"),
            "ips": public[:4],
        }
    return _cached(f"dns:{domain}", _CACHE_TTL, produce)


def check_rdap(domain: str) -> dict:
    """Registration date, registrar and nameservers via RDAP (no key needed)."""
    def produce() -> dict:
        r = requests.get(
            f"https://rdap.org/domain/{domain}",
            timeout=HTTP_TIMEOUT, headers={"User-Agent": _USER_AGENT},
        )
        if r.status_code == 404:
            # rdap.org does not serve every TLD, so a 404 is ambiguous: either
            # the domain is unregistered or the TLD is unsupported. Reported,
            # but never scored, to avoid false positives.
            return {"status": "not_found", "note": "unregistered, or TLD not served by RDAP"}
        r.raise_for_status()
        data = r.json()

        registered = None
        for ev in data.get("events") or []:
            if ev.get("eventAction") == "registration":
                registered = ev.get("eventDate")
                break

        age_days = None
        if registered:
            try:
                from datetime import datetime, timezone
                dt = datetime.fromisoformat(str(registered).replace("Z", "+00:00"))
                age_days = (datetime.now(timezone.utc) - dt).days
            except Exception:
                age_days = None

        registrar = ""
        for ent in data.get("entities") or []:
            if "registrar" not in (ent.get("roles") or []):
                continue
            # RDAP embeds contact details as a vCard: each field is
            # [name, params, type, value], so the human name is field "fn".
            vcard = (ent.get("vcardArray") or [None, []])[1] or []
            for f in vcard:
                if len(f) >= 4 and f[0] == "fn":
                    registrar = f[3]
                    break
            if not registrar:
                registrar = ent.get("handle") or ""
            break

        return {
            "status": "ok",
            "registered": registered,
            "age_days": age_days,
            "registrar": registrar,
            "nameservers": [ns.get("ldhName", "")
                            for ns in (data.get("nameservers") or [])][:4],
        }
    return _cached(f"rdap:{domain}", _CACHE_TTL * 6, produce)


def check_safe_browsing(url: str) -> dict:
    """Google Safe Browsing threat match. Needs a free API key."""
    key = os.environ.get("GOOGLE_SAFE_BROWSING_API_KEY", "").strip()
    if not key:
        return {"status": "not_configured",
                "detail": "Add GOOGLE_SAFE_BROWSING_API_KEY to backend/.env"}
    if not url:
        return {"status": "skipped"}

    def produce() -> dict:
        payload = {
            "client": {"clientId": "ScamSense", "clientVersion": "1.0"},
            "threatInfo": {
                "threatTypes": [
                    "MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE",
                    "POTENTIALLY_HARMFUL_APPLICATION",
                ],
                "platformTypes": ["ANY_PLATFORM"],
                "threatEntryTypes": ["URL"],
                "threatEntries": [{"url": url}],
            },
        }
        r = requests.post(
            "https://safebrowsing.googleapis.com/v4/threatMatches:find",
            params={"key": key}, json=payload, timeout=HTTP_TIMEOUT,
            headers={"User-Agent": _USER_AGENT},
        )
        if r.status_code in (400, 403):
            return {"status": "key_rejected",
                    "detail": "Safe Browsing rejected the key (check it is enabled)"}
        r.raise_for_status()
        matches = r.json().get("matches") or []
        return {
            "status": "unsafe" if matches else "clean",
            "threat_types": sorted({m.get("threatType", "") for m in matches if m.get("threatType")}),
            "match_count": len(matches),
        }
    return _cached(f"gsb:{url}", _CACHE_TTL, produce)


def check_virustotal(domain: str) -> dict:
    """VirusTotal domain report. Needs a free API key."""
    key = os.environ.get("VIRUSTOTAL_API_KEY", "").strip()
    if not key:
        return {"status": "not_configured",
                "detail": "Add VIRUSTOTAL_API_KEY to backend/.env"}
    if not domain:
        return {"status": "skipped"}

    def produce() -> dict:
        r = requests.get(
            f"https://www.virustotal.com/api/v3/domains/{domain}",
            timeout=HTTP_TIMEOUT,
            headers={"x-apikey": key, "User-Agent": _USER_AGENT},
        )
        if r.status_code in (401, 403):
            return {"status": "key_rejected",
                    "detail": "VirusTotal rejected the key"}
        if r.status_code == 404:
            return {"status": "unknown_domain", "malicious": 0, "total": 0}
        r.raise_for_status()
        stats = (((r.json().get("data") or {}).get("attributes") or {})
                 .get("last_analysis_stats") or {})
        malicious = int(stats.get("malicious", 0)) + int(stats.get("suspicious", 0))
        total = sum(int(v) for v in stats.values() if isinstance(v, int))
        return {"status": "ok", "malicious": malicious, "total": total}
    return _cached(f"vt:{domain}", _CACHE_TTL, produce)


def check_openphish(domain: str) -> dict:
    """OpenPhish community feed. No key; refreshed about once an hour."""
    def produce() -> dict:
        # Cache the *feed*, not the answer for one domain: caching a
        # per-domain boolean would hand every later domain this domain's verdict.
        r = requests.get("https://openphish.com/feed.txt",
                         timeout=HTTP_TIMEOUT, headers={"User-Agent": _USER_AGENT})
        r.raise_for_status()
        # The feed starts with '#' metadata lines; those are not domains.
        listed = {ln.strip().lower() for ln in r.text.splitlines()
                  if ln.strip() and not ln.strip().startswith("#")}
        return {"status": "ok", "feed": sorted(listed), "feed_size": len(listed)}
    feed = _cached("openphish:feed", 3600.0, produce)
    if feed.get("status") != "ok":
        return {"status": feed.get("status", "unavailable")}
    return {"status": "ok", "listed": domain.lower() in feed["feed"],
            "feed_size": feed["feed_size"]}


def check_redirects(url: str) -> dict:
    """Follow the URL and report the hop count and final host."""
    if not url:
        return {"status": "skipped"}
    if not url.startswith(("http://", "https://")):
        url = "http://" + url

    def produce() -> dict:
        host = urlparse(url).hostname or ""
        ips = _resolve_ips(host)
        if ips and not any(_is_public_ip(ip) for ip in ips):
            # Refuse to fetch: this is the SSRF guard.
            return {"status": "refused", "reason": "host does not resolve publicly"}
        try:
            r = requests.get(url, timeout=HTTP_TIMEOUT, allow_redirects=True,
                             headers={"User-Agent": _USER_AGENT}, stream=True)
            hops = len(r.history)
            final = r.url
            r.close()
            final_host = urlparse(final).hostname or ""
            start_host = _registered_domain(url)
            final_reg = _registered_domain(final)
            return {
                "status": "ok",
                "hops": hops,
                "final_url": final[:300],
                "final_domain": final_reg,
                "crosses_domain": bool(final_reg and start_host and final_reg != start_host),
                "downgraded_to_http": final.startswith("http://"),
            }
        except requests.RequestException as e:
            return {"status": "unreachable", "detail": type(e).__name__}
    return _cached(f"redir:{url}", _CACHE_TTL, produce)


# ---------- Signal assembly ----------
def _build_signals(domain: str, url: str, providers: dict) -> list[Signal]:
    signals: list[Signal] = []

    gsb = providers.get("safe_browsing") or {}
    vt = providers.get("virustotal") or {}
    oph = providers.get("openphish") or {}
    dns = providers.get("dns") or {}
    rdap = providers.get("rdap") or {}
    redir = providers.get("redirects") or {}

    # --- +20 known malicious (any authoritative blocklist) ---
    if gsb.get("status") == "unsafe":
        threats = ", ".join(gsb.get("threat_types") or []) or "malware"
        signals.append(Signal(
            "known_malicious",
            f"Listed as unsafe by Google Safe Browsing ({threats})",
            POINTS_KNOWN_MALICIOUS, "Google Safe Browsing",
            {"threat_types": gsb.get("threat_types") or []},
        ))
    elif oph.get("status") == "ok" and oph.get("listed"):
        signals.append(Signal(
            "known_malicious",
            "Domain appears on the OpenPhish live phishing feed",
            POINTS_KNOWN_MALICIOUS, "OpenPhish",
            {"feed_size": oph.get("feed_size")},
        ))

    # --- +10 several independent engines ---
    if vt.get("status") == "ok" and int(vt.get("malicious", 0)) >= MULTI_ENGINE_THRESHOLD:
        signals.append(Signal(
            "multi_engine_flag",
            f"Flagged by {vt['malicious']} of {vt.get('total', '?')} VirusTotal engines",
            POINTS_MULTI_ENGINE, "VirusTotal",
            {"malicious": vt.get("malicious"), "total": vt.get("total")},
        ))

    # --- +5 very new domain ---
    age = rdap.get("age_days")
    if isinstance(age, int) and 0 <= age < NEW_DOMAIN_DAYS:
        signals.append(Signal(
            "new_domain",
            f"Domain was registered only {age} day(s) ago (under {NEW_DOMAIN_DAYS})",
            POINTS_NEW_DOMAIN, "RDAP",
            {"age_days": age, "registered": rdap.get("registered"),
             "registrar": rdap.get("registrar")},
        ))

    # --- +5 suspicious redirect ---
    if redir.get("status") == "ok":
        reasons = []
        if redir.get("crosses_domain"):
            reasons.append(f"redirects to a different domain ({redir.get('final_domain')})")
        if int(redir.get("hops", 0)) >= SUSPICIOUS_REDIRECT_HOPS:
            reasons.append(f"{redir['hops']} redirect hops")
        if redir.get("downgraded_to_http") and url.startswith("https://"):
            reasons.append("downgrades back to plain HTTP")
        if reasons:
            signals.append(Signal(
                "suspicious_redirect", "Suspicious redirect: " + "; ".join(reasons),
                POINTS_SUSPICIOUS_REDIRECT, "Redirect trace",
                {"hops": redir.get("hops"), "final_domain": redir.get("final_domain")},
            ))

    # --- +10 does not resolve ---
    if dns.get("status") == "no_dns":
        signals.append(Signal(
            "no_dns", "Domain does not resolve in DNS",
            POINTS_NO_DNS, "DNS", {},
        ))

    return signals


_UNAVAILABLE = {
    "safe_browsing": "Google Safe Browsing: not configured",
    "virustotal": "VirusTotal: not configured",
    "openphish": "OpenPhish feed unreachable",
    "rdap": "RDAP lookup unavailable",
    "redirects": "Redirect trace unavailable",
    "dns": "DNS lookup failed",
}


def analyse(url: str, providers_to_run: list[str] | None = None) -> ReputationResult:
    """Run every configured provider in parallel and assemble the signals.

    Safe to call with an empty URL: it simply reports that there is nothing to
    look up, which is what a message-only scan does.
    """
    domain = _registered_domain(url)
    if not domain:
        return ReputationResult(notes=["No domain to look up."])

    jobs = {
        "rdap": lambda: check_rdap(domain),
        "dns": lambda: check_dns(domain),
        "safe_browsing": lambda: check_safe_browsing(url if url.startswith("http") else f"http://{domain}"),
        "virustotal": lambda: check_virustotal(domain),
        "openphish": lambda: check_openphish(domain),
        "redirects": lambda: check_redirects(url),
    }
    if providers_to_run is not None:
        jobs = {k: v for k, v in jobs.items() if k in providers_to_run}

    providers: dict = {}
    with ThreadPoolExecutor(max_workers=len(jobs) or 1) as pool:
        futures = {name: pool.submit(fn) for name, fn in jobs.items()}
        for name, fut in futures.items():
            try:
                providers[name] = fut.result(timeout=HTTP_TIMEOUT + 4)
            except Exception:
                providers[name] = {"status": "error"}

    signals = _build_signals(domain, url, providers)
    raw_points = sum(s.points for s in signals)
    bump = min(raw_points / 100.0, MAX_REPUTATION_BUMP)

    notes = []
    answered = [n for n, p in providers.items()
                if p.get("status") not in ("error", "unavailable", "not_configured")]
    if not answered:
        notes.append("No reputation source was available, so the ML verdict is unchanged.")
    for name, p in providers.items():
        if p.get("status") == "not_configured":
            notes.append(_UNAVAILABLE.get(name, f"{name}: not configured"))
    if raw_points > MAX_REPUTATION_BUMP * 100:
        notes.append(
            f"Reputation evidence scored {raw_points:.0f} points; capped at "
            f"{MAX_REPUTATION_BUMP * 100:.0f} so it cannot decide the verdict alone."
        )

    return ReputationResult(
        domain=domain,
        available=bool(answered),
        signals=signals,
        bump=bump,
        providers=providers,
        notes=notes,
    )
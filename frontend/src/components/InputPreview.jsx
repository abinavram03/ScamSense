import { Globe, Lock, AlertTriangle, ExternalLink, Link2, Shield, ShieldX, FileText, Eye } from "lucide-react";

const SUSPICIOUS_WORDS = [
  "urgent", "immediately", "now", "asap", "final", "warning", "act", "expire",
  "blocked", "suspended", "disconnected", "illegal", "freeze", "arrest",
  "otp", "password", "pin", "cvv", "verify", "confirm", "credentials", "kyc",
  "prize", "won", "winner", "reward", "gift", "bonus", "inheritance", "free",
  "click", "link", "tap here", "visit", "bit.ly", "tinyurl",
  "$", "lakh", "crore", "rs.", "lottery", "cashback", "refund", "claim",
];

function parseUrl(url) {
  try {
    const u = new URL(url);
    return {
      protocol: u.protocol.replace(":", ""),
      hostname: u.hostname,
      pathname: u.pathname,
      search: u.search,
      hash: u.hash,
      isHttps: u.protocol === "https:",
      port: u.port,
    };
  } catch {
    return null;
  }
}

const SAFE_DOMAINS = [
  "google.com", "github.com", "youtube.com", "amazon.com", "microsoft.com",
  "apple.com", "facebook.com", "instagram.com", "linkedin.com", "twitter.com",
  "netflix.com", "paypal.com", "wikipedia.org", "stackoverflow.com",
  "flipkart.com", "hdfcbank.com", "icicibank.com", "sbi.co.in",
  "paytm.com", "phonepe.com", "jio.com", "airtel.in",
];

const SUSPICIOUS_TLDS = ["xyz", "top", "click", "tk", "gq", "ml", "pw", "ru", "cn", "buzz", "club", "online", "site"];

function getDomainRisk(hostname) {
  const parts = hostname.split(".");
  const tld = parts[parts.length - 1];
  const regDomain = parts.length >= 2 ? parts.slice(-2).join(".") : hostname;
  if (SAFE_DOMAINS.includes(regDomain)) return "safe";
  if (SUSPICIOUS_TLDS.includes(tld)) return "suspicious";
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return "suspicious";
  return "unknown";
}

export function UrlPreview({ url }) {
  if (!url || !url.trim()) return null;
  const parsed = parseUrl(url);
  if (!parsed) {
    return (
      <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 animate-fade-in">
        <div className="flex items-center gap-2 text-amber-600">
          <AlertTriangle className="h-4 w-4" />
          <span className="text-xs font-bold">Invalid URL format</span>
        </div>
      </div>
    );
  }

  const domainRisk = getDomainRisk(parsed.hostname);
  const riskColor = domainRisk === "safe" ? "text-emerald-600 bg-emerald-50 border-emerald-200" :
    domainRisk === "suspicious" ? "text-amber-600 bg-amber-50 border-amber-200" :
    "text-gray-500 bg-gray-50 border-gray-200";

  const riskLabel = domainRisk === "safe" ? "Trusted Domain" :
    domainRisk === "suspicious" ? "Suspicious TLD" : "Unverified Domain";

  return (
    <div className="mt-3 rounded-2xl border border-gray-100 bg-white shadow-card overflow-hidden animate-fade-in">
      <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
        <Eye className="h-3.5 w-3.5 text-gray-400" />
        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">URL Preview</span>
      </div>
      <div className="p-4 space-y-3">
        {/* Protocol badge + domain */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-md border ${
            parsed.isHttps ? "text-emerald-600 bg-emerald-50 border-emerald-200" : "text-rose-600 bg-rose-50 border-rose-200"
          }`}>
            {parsed.isHttps ? <Lock className="inline h-3 w-3 mr-1" /> : <Globe className="inline h-3 w-3 mr-1" />}
            {parsed.protocol}
          </span>
          <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-md border ${riskColor}`}>
            {domainRisk === "safe" ? <Shield className="inline h-3 w-3 mr-1" /> :
             domainRisk === "suspicious" ? <AlertTriangle className="inline h-3 w-3 mr-1" /> :
             <Globe className="inline h-3 w-3 mr-1" />}
            {riskLabel}
          </span>
          {parsed.port && parsed.port !== "80" && parsed.port !== "443" && (
            <span className="text-[10px] font-mono text-gray-400">:{parsed.port}</span>
          )}
        </div>

        {/* Full URL display */}
        <div className="font-mono text-sm text-gray-800 break-all bg-gray-50 rounded-xl px-4 py-3 border border-gray-100">
          <span className="text-gray-400">{parsed.protocol}://</span>
          <span className={`font-bold ${domainRisk === "safe" ? "text-emerald-600" : domainRisk === "suspicious" ? "text-amber-600" : "text-gray-700"}`}>
            {parsed.hostname}
          </span>
          {parsed.port && parsed.port !== "80" && parsed.port !== "443" && (
            <span className="text-gray-400">:{parsed.port}</span>
          )}
          {parsed.pathname !== "/" && (
            <span className="text-violet-500">{parsed.pathname}</span>
          )}
          {parsed.search && (
            <span className="text-amber-500">{parsed.search}</span>
          )}
          {parsed.hash && (
            <span className="text-gray-400">{parsed.hash}</span>
          )}
        </div>

        {/* Domain analysis grid */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-gray-50 rounded-xl px-3 py-2 border border-gray-100">
            <div className="text-[9px] font-bold uppercase tracking-widest text-gray-400">Domain</div>
            <div className="text-xs font-mono font-bold text-gray-700 mt-0.5 truncate">{parsed.hostname}</div>
          </div>
          <div className="bg-gray-50 rounded-xl px-3 py-2 border border-gray-100">
            <div className="text-[9px] font-bold uppercase tracking-widest text-gray-400">Path</div>
            <div className="text-xs font-mono font-bold text-gray-700 mt-0.5 truncate">{parsed.pathname || "/"}</div>
          </div>
          <div className="bg-gray-50 rounded-xl px-3 py-2 border border-gray-100">
            <div className="text-[9px] font-bold uppercase tracking-widest text-gray-400">TLD</div>
            <div className={`text-xs font-mono font-bold mt-0.5 ${domainRisk === "suspicious" ? "text-amber-600" : "text-gray-700"}`}>
              .{parsed.hostname.split(".").pop()}
            </div>
          </div>
        </div>

        {/* Warning indicators */}
        <div className="flex flex-wrap gap-1.5">
          {!parsed.isHttps && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-600 border border-rose-200">No HTTPS</span>
          )}
          {parsed.search && parsed.search.toLowerCase().includes("otp") && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-600 border border-amber-200">Contains OTP param</span>
          )}
          {parsed.search && (parsed.search.toLowerCase().includes("redirect") || parsed.search.toLowerCase().includes("url")) && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-600 border border-amber-200">Has redirect param</span>
          )}
          {parsed.hostname.split(".").length > 3 && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-600 border border-violet-200">Deep subdomain</span>
          )}
          /(\d{1,3}\.){3}\d{1,3}/.test(parsed.hostname) && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-600 border border-rose-200">IP address in URL</span>
          )}
        </div>
      </div>
    </div>
  );
}

function highlightSuspiciousWords(text, type) {
  if (!text) return null;
  const lines = text.split("\n");
  return lines.map((line, lineIdx) => {
    const words = line.split(/(\s+)/);
    const parts = words.map((word, i) => {
      const lower = word.toLowerCase().trim();
      const isSuspicious = SUSPICIOUS_WORDS.some(sw => lower.includes(sw));
      if (isSuspicious) {
        return (
          <span key={`${lineIdx}-${i}`} className="bg-amber-200/70 text-amber-900 font-bold rounded px-0.5">
            {word}
          </span>
        );
      }
      return word;
    });
    return (
      <span key={lineIdx}>
        {parts}
        {lineIdx < lines.length - 1 && <br />}
      </span>
    );
  });
}

export function MessagePreview({ message, type }) {
  if (!message || !message.trim()) return null;

  const wordCount = message.trim().split(/\s+/).length;
  const charCount = message.length;
  const suspiciousCount = SUSPICIOUS_WORDS.filter(w => message.toLowerCase().includes(w));
  const hasUrgency = /urgent|immediately|now|asap|final warning|expire|suspended|blocked/i.test(message);
  const hasCredentials = /otp|password|pin|cvv|verify|confirm|credentials|kyc/i.test(message);
  const hasMoney = /prize|won|winner|reward|gift|bonus|free|lottery|cashback|refund|\$/i.test(message);
  const hasLinks = /https?:\/\/|bit\.ly|tinyurl|click here|tap here|visit/i.test(message);

  const label = type === "email" ? "Email" : "Message";

  return (
    <div className="mt-3 rounded-2xl border border-gray-100 bg-white shadow-card overflow-hidden animate-fade-in">
      <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Eye className="h-3.5 w-3.5 text-gray-400" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{label} Preview</span>
        </div>
        <div className="flex items-center gap-3 text-[10px] font-mono text-gray-400">
          <span>{wordCount} words</span>
          <span>{charCount} chars</span>
          {suspiciousCount.length > 0 && (
            <span className="text-amber-500 font-bold">{suspiciousCount.length} flagged</span>
          )}
        </div>
      </div>
      <div className="p-4 space-y-3">
        {/* Highlighted content */}
        <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-3 text-sm text-gray-700 leading-relaxed max-h-40 overflow-y-auto">
          {highlightSuspiciousWords(message, type)}
        </div>

        {/* Signal badges */}
        <div className="flex flex-wrap gap-1.5">
          {hasUrgency && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-600 border border-rose-200">Urgency language</span>
          )}
          {hasCredentials && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-600 border border-amber-200">Credential request</span>
          )}
          {hasMoney && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-600 border border-violet-200">Money/prize language</span>
          )}
          {hasLinks && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-100 text-sky-600 border border-sky-200">Contains links</span>
          )}
          {!hasUrgency && !hasCredentials && !hasMoney && !hasLinks && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-600 border border-emerald-200">No obvious signals</span>
          )}
        </div>

        {/* Flagged words list */}
        {suspiciousCount.length > 0 && (
          <div>
            <div className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">Flagged words</div>
            <div className="flex flex-wrap gap-1">
              {suspiciousCount.map((w, i) => (
                <span key={i} className="text-[10px] font-mono font-bold bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-md">
                  {w}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function ImagePreview({ preview, file }) {
  if (!preview) return null;
  return (
    <div className="mt-3 rounded-2xl border border-gray-100 bg-white shadow-card overflow-hidden animate-fade-in">
      <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Eye className="h-3.5 w-3.5 text-gray-400" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Image Preview</span>
        </div>
        {file && (
          <div className="flex items-center gap-3 text-[10px] font-mono text-gray-400">
            <span>{(file.size / 1024).toFixed(1)} KB</span>
            <span>{file.type}</span>
          </div>
        )}
      </div>
      <div className="p-4 space-y-3">
        <img src={preview} alt="Upload preview" className="w-full max-h-64 object-contain rounded-xl border border-gray-200 shadow-card" />
        <div className="flex items-center gap-2 text-[10px] text-gray-400">
          <FileText className="h-3 w-3" />
          <span>Text will be extracted via OCR after scanning</span>
        </div>
      </div>
    </div>
  );
}

export function FilePreview({ file }) {
  if (!file) return null;
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  const extColors = {
    txt: "text-gray-600 bg-gray-50 border-gray-200",
    csv: "text-emerald-600 bg-emerald-50 border-emerald-200",
    html: "text-violet-600 bg-violet-50 border-violet-200",
    eml: "text-sky-600 bg-sky-50 border-sky-200",
  };
  return (
    <div className="mt-3 rounded-2xl border border-gray-100 bg-white shadow-card overflow-hidden animate-fade-in">
      <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
        <Eye className="h-3.5 w-3.5 text-gray-400" />
        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">File Preview</span>
      </div>
      <div className="p-4 flex items-center gap-4">
        <div className={`h-12 w-12 rounded-xl border flex items-center justify-center flex-none ${extColors[ext] || extColors.txt}`}>
          <FileText className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-gray-900 truncate">{file.name}</div>
          <div className="flex items-center gap-3 mt-0.5">
            <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-md border ${extColors[ext] || extColors.txt}`}>
              .{ext}
            </span>
            <span className="text-[10px] font-mono text-gray-400">{(file.size / 1024).toFixed(1)} KB</span>
            <span className="text-[10px] text-gray-400">Text content will be extracted for analysis</span>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  Link2, MessageSquare, Loader2, ShieldCheck, LogOut, Radar, History,
  Shield, ShieldX, AlertTriangle, Clock, Upload, FileText, Image, Mail,
  Zap, X, CheckCircle, Scan, Download, Search, QrCode, Languages,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { api, formatApiError } from "@/lib/api";
import ResultCard from "@/components/ResultCard";
import { UrlPreview, MessagePreview, ImagePreview, FilePreview } from "@/components/InputPreview";

const TABS = [
  { id: "url", label: "URL", icon: Link2, color: "text-violet-600", activeBg: "bg-violet-50", activeBorder: "border-violet-500" },
  { id: "message", label: "Message", icon: MessageSquare, color: "text-sky-600", activeBg: "bg-sky-50", activeBorder: "border-sky-500" },
  { id: "email", label: "Email", icon: Mail, color: "text-amber-600", activeBg: "bg-amber-50", activeBorder: "border-amber-500" },
  { id: "file", label: "File", icon: FileText, color: "text-emerald-600", activeBg: "bg-emerald-50", activeBorder: "border-emerald-500" },
  { id: "image", label: "Image", icon: Image, color: "text-coral-600", activeBg: "bg-rose-50", activeBorder: "border-rose-500" },
  { id: "qr", label: "QR Code", icon: QrCode, color: "text-teal-600", activeBg: "bg-teal-50", activeBorder: "border-teal-500" },
];

const TAB_COLORS = {
  url: { ring: "focus:ring-violet-500/20 focus:border-violet-400", icon: "text-violet-400 group-focus-within:text-violet-500" },
  message: { ring: "focus:ring-sky-500/20 focus:border-sky-400", icon: "text-sky-400 group-focus-within:text-sky-500" },
  email: { ring: "focus:ring-amber-500/20 focus:border-amber-400", icon: "text-amber-400 group-focus-within:text-amber-500" },
};

const EXAMPLES = [
  {
    label: "Phishing",
    gradient: "gradient-sunset",
    text: "text-white",
    url: "http://secure-paypal-verify.xyz/login?redirect=verify",
    message: "URGENT: Your account will be suspended. Click here to verify your OTP now.",
  },
  {
    label: "Safe",
    gradient: "gradient-mint",
    text: "text-white",
    url: "https://github.com/openai/openai-python",
    message: "Hey, are we still on for coffee tomorrow at 10?",
  },
  {
    label: "Mixed",
    gradient: "gradient-ocean",
    text: "text-white",
    url: "https://www.google.com/search?q=hello",
    message: "You have WON $1,000,000 lottery! Claim your prize NOW! Click http://bit.ly/fake",
  },
];

const SAMPLE_EMAIL = `From: security@paypa1-verify.xyz
Subject: URGENT: Your account has been compromised!

Dear Customer,

We have detected unauthorized activity on your account. Your account will be suspended within 24 hours unless you verify your identity immediately.

Please click the link below to verify your OTP and confirm your credentials:
http://secure-paypal-verify.xyz/login?redirect=verify

If you do not verify within 24 hours, your account will be permanently frozen.

Regards,
PayPal Security Team`;

const SAMPLE_FILE_CONTENT = `ALERT: Suspicious Activity Detected on Your Account

Your bank account has been flagged for unusual activity. Immediate action required.

Transaction Details:
- Amount: $4,999.00
- Merchant: UNKNOWN
- Status: PENDING VERIFICATION

To verify this transaction, please provide your OTP and PIN at:
http://bank-verify-secure.xyz/confirm

This is your final warning. Your account will be frozen within 1 hour if you do not respond.

DO NOT share this OTP with anyone except our verification officer.
Call 1800-FAKE-NUM for immediate assistance.`;

// Pre-rendered, genuinely decodable QR code used by the sample button, so the
// demo exercises the same decode path a user's photo takes.
const SAMPLE_QR_IMAGE =
  "data:image/png;base64,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";
const SAMPLE_QR_URL = "http://paypa1-verify-account.xyz/login";

async function createSampleQr() {
  const res = await fetch(SAMPLE_QR_IMAGE);
  const blob = await res.blob();
  return new File([blob], "sample_phishing_qr.png", { type: "image/png" });
}

function createSampleImage(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 700;
  canvas.height = 200;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 700, 200);
  ctx.fillStyle = "#cc0000";
  ctx.font = "bold 20px Arial";
  const textLines = text.split("\n");
  textLines.forEach((line, i) => {
    ctx.fillText(line, 20, 40 + i * 30);
  });
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      const file = new File([blob], "sample_phishing.png", { type: "image/png" });
      resolve(file);
    }, "image/png");
  });
}

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState("url");
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [scans, setScans] = useState([]);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [uploadedPreview, setUploadedPreview] = useState(null);
  const [historyFilter, setHistoryFilter] = useState("All");
  const [historyQuery, setHistoryQuery] = useState("");
  const [clearing, setClearing] = useState(false);
  const [toast, setToast] = useState("");
  const [languages, setLanguages] = useState([]);
  const [langOpen, setLangOpen] = useState(false);
  const [langTarget, setLangTarget] = useState("");
  const [translating, setTranslating] = useState(false);
  const [translation, setTranslation] = useState(null);
  const [translationError, setTranslationError] = useState("");
  const fileRef = useRef(null);
  const imageRef = useRef(null);
  const qrRef = useRef(null);
  const langMenuRef = useRef(null);
  const translationRef = useRef(null);

  useEffect(() => {
    api.get("/languages")
      .then(({ data }) => setLanguages(data.languages || []))
      .catch(() => setLanguages([]));
  }, []);

  useEffect(() => {
    if (!langOpen) return;
    const onDown = (e) => {
      if (langMenuRef.current && !langMenuRef.current.contains(e.target)) setLangOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setLangOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [langOpen]);

  const translateTo = async (target) => {
    setLangTarget(target);
    setLangOpen(false);
    // message_content is the full submitted text; message_preview is only the
    // first 200 characters and would silently truncate the translation.
    const body = result?.extracted_text || result?.message_content || result?.message_preview || "";
    if (!body?.trim()) {
      setTranslationError("This scan has no message text to translate.");
      setTranslation(null);
      return;
    }
    // Send the English explanation too, so the reader sees the whole result in
    // their language instead of an English wall around a translated message.
    const reasons = [
      ...(result?.url_reasons || []),
      ...(result?.message_reasons || []),
    ].filter(Boolean);
    setTranslating(true);
    setTranslationError("");
    setTranslation(null);
    try {
      const { data } = await api.post("/translate", {
        text: body,
        target,
        verdict: result?.verdict || null,
        reasons,
        recommendation: result?.recommendation || null,
      });
      setTranslation(data);
        // The language picker sits below this card, so without this the user
        // watches the picker vanish and sees no change on screen.
        requestAnimationFrame(() =>
          translationRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
        );
    } catch (err) {
      setTranslationError(formatApiError(err));
    } finally {
      setTranslating(false);
    }
  };

  useEffect(() => { setTranslation(null); setTranslationError(""); setLangTarget(""); }, [result]);

  const loadScans = useCallback(async () => {
    try {
      const { data } = await api.get("/scans");
      setScans(data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadScans(); }, [loadScans]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const notify = useCallback((msg) => setToast(msg), []);

  const removeScan = useCallback(async (id) => {
    try {
      await api.delete(`/scans/${id}`);
      setScans((prev) => prev.filter((s) => s.id !== id));
      notify("Scan removed");
    } catch (err) {
      notify(formatApiError(err));
    }
  }, [notify]);

  const clearHistory = useCallback(async () => {
    setClearing(true);
    try {
      const { data } = await api.delete("/scans");
      setScans([]);
      notify(`Cleared ${data.deleted} scan${data.deleted === 1 ? "" : "s"}`);
    } catch (err) {
      notify(formatApiError(err));
    } finally {
      setClearing(false);
    }
  }, [notify]);

  const exportCsv = useCallback(async () => {
    try {
      const { data } = await api.get("/export", { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([data], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `scamsense-history-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notify("History exported");
    } catch (err) {
      notify(formatApiError(err));
    }
  }, [notify]);

  const visibleScans = useMemo(() => {
    const q = historyQuery.trim().toLowerCase();
    return scans.filter((s) => {
      if (historyFilter !== "All" && s.verdict !== historyFilter) return false;
      if (!q) return true;
      return (s.url || "").toLowerCase().includes(q) || (s.message || "").toLowerCase().includes(q);
    });
  }, [scans, historyFilter, historyQuery]);

  const reset = () => { setUrl(""); setMessage(""); setResult(null); setError(""); setUploadedFile(null); setUploadedPreview(null); };

  const submitText = async (e) => {
    e.preventDefault();
    if (activeTab === "file" || activeTab === "image" || activeTab === "qr") return;
    const input = activeTab === "url" ? url : message;
    if (!input.trim()) return;
    setError(""); setLoading(true); setResult(null);
    try {
      const payload = activeTab === "url" ? { url, message: "" } : { url: "", message };
      const { data } = await api.post("/predict", payload);
      setResult({ ...data, model_used: activeTab === "url" ? "URL RF" : activeTab === "email" ? "Message RF" : "URL + Message RF" });
      loadScans();
    } catch (err) { setError(formatApiError(err)); }
    finally { setLoading(false); }
  };

  const submitFile = async () => {
    if (!uploadedFile) return;
    setError(""); setLoading(true); setResult(null);
    const form = new FormData();
    form.append("file", uploadedFile);
    try {
      const { data } = await api.post("/scan-file", form);
      setResult({ ...data, scan_type: "File Upload", model_used: "URL + Message RF" });
      loadScans();
    } catch (err) { setError(formatApiError(err)); }
    finally { setLoading(false); }
  };

  const submitImage = async () => {
    if (!uploadedFile) return;
    setError(""); setLoading(true); setResult(null);
    const form = new FormData();
    form.append("file", uploadedFile);
    try {
      const { data } = await api.post("/scan-image", form);
      setResult({ ...data, scan_type: "Image OCR", model_used: "URL + Message RF + Tesseract" });
      loadScans();
    } catch (err) { setError(formatApiError(err)); }
    finally { setLoading(false); }
  };

  const submitQr = async () => {
    if (!uploadedFile) return;
    setError(""); setLoading(true); setResult(null);
    const form = new FormData();
    form.append("file", uploadedFile);
    try {
      const { data } = await api.post("/scan-qr", form);
      setResult({
        ...data,
        scan_type: "QR Code",
        model_used: data.qr_url ? "URL RF + SHAP" : "Message RF + Tesseract",
      });
      loadScans();
    } catch (err) { setError(formatApiError(err)); }
    finally { setLoading(false); }
  };

  const handleFileDrop = (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0] || e.target?.files?.[0];
    if (!f) return;
    setUploadedFile(f);
    setResult(null);
    if (f.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (ev) => setUploadedPreview(ev.target.result);
      reader.readAsDataURL(f);
    } else {
      setUploadedPreview(null);
    }
  };

  const loadExample = (ex) => {
    setUrl(ex.url);
    setMessage(ex.message);
    setActiveTab("url");
    setResult(null); setError(""); setUploadedFile(null); setUploadedPreview(null);
  };

  const loadSampleEmail = () => {
    setMessage(SAMPLE_EMAIL);
    setResult(null); setError(""); setUploadedFile(null); setUploadedPreview(null);
  };

  const loadSampleFile = () => {
    const blob = new Blob([SAMPLE_FILE_CONTENT], { type: "text/plain" });
    const file = new File([blob], "suspicious_alert.txt", { type: "text/plain" });
    setUploadedFile(file);
    setResult(null); setError(""); setMessage(""); setUrl("");
  };

  const loadSampleImage = async () => {
    const sampleText = "URGENT: Your OTP is 123456. Verify NOW!\nClick http://phishing.xyz or account frozen!";
    const file = await createSampleImage(sampleText);
    setUploadedFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setUploadedPreview(ev.target.result);
    reader.readAsDataURL(file);
    setResult(null); setError(""); setMessage(""); setUrl("");
  };

  const loadSampleQr = async () => {
    const file = await createSampleQr();
    setUploadedFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setUploadedPreview(ev.target.result);
    reader.readAsDataURL(file);
    setResult(null); setError(""); setMessage(""); setUrl("");
  };

  const phishingCount = scans.filter((s) => s.verdict === "Phishing").length;
  const suspiciousCount = scans.filter((s) => s.verdict === "Suspicious").length;
  const safeCount = scans.filter((s) => s.verdict === "Safe").length;

  const empty = activeTab === "url" ? !url.trim() :
    activeTab === "message" || activeTab === "email" ? !message.trim() :
    !uploadedFile;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (activeTab === "file") { submitFile(); return; }
    if (activeTab === "image") { submitImage(); return; }
    if (activeTab === "qr") { submitQr(); return; }
    submitText(e);
  };

  const currentTab = TABS.find((t) => t.id === activeTab);

  return (
    <div className="min-h-screen bg-[#fafbff]">
      {/* Subtle dot grid */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.02]"
        style={{ backgroundImage: 'radial-gradient(circle, #6c3ff5 1px, transparent 1px)', backgroundSize: '24px 24px' }}
      />

      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-xl border-b border-gray-100">
        <div className="mx-auto max-w-7xl px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl gradient-brand flex items-center justify-center shadow-glow-brand">
              <Shield className="h-5 w-5 text-white" strokeWidth={2.5} />
            </div>
            <div>
              <div className="text-lg font-extrabold tracking-tight text-gray-900 leading-none">ScamSense</div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-gradient">Scam Detection</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden sm:block text-right">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Signed in</div>
              <div data-testid="user-email" className="text-xs font-medium text-gray-700 mt-0.5 font-mono">{user?.email}</div>
            </div>
            <button
              data-testid="logout-button"
              onClick={logout}
              className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-white hover:bg-rose-500 border border-gray-200 hover:border-rose-500 rounded-xl px-3 py-2 transition-all duration-300 bg-white"
            >
              <LogOut className="h-4 w-4" /> Log out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8 relative">
        <div className="mb-8">
          <div className="text-[11px] font-bold uppercase tracking-widest text-gradient flex items-center gap-2">
            <Zap className="h-3 w-3" /> Threat Console
          </div>
          <h1 className="mt-3 text-4xl md:text-5xl font-black tracking-tight text-gray-900">
            Scan a URL, message, or{" "}
            <span className="text-gradient">file.</span>
          </h1>
          <p className="mt-3 text-gray-500 max-w-2xl text-sm leading-relaxed">
            Multiple ML models combine SHAP explainability to score and explain scam risk across URLs, messages, emails, files, and images.
          </p>
        </div>

        {/* Vibrant Stats */}
        {scans.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
            <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-card hover:shadow-elevated transition-all duration-300">
              <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Total Scans</div>
              <div className="text-3xl font-black text-gray-900">{scans.length}</div>
              <div className="mt-2 h-1 rounded-full bg-gray-100 overflow-hidden"><div className="h-full gradient-brand rounded-full" style={{ width: '100%' }} /></div>
            </div>
            <div className="bg-white rounded-2xl p-4 border border-rose-100 shadow-card hover:shadow-glow-rose transition-all duration-300">
              <div className="text-[10px] font-bold uppercase tracking-widest text-rose-500 mb-1">Phishing</div>
              <div className="text-3xl font-black text-rose-600">{phishingCount}</div>
              <div className="mt-2 h-1 rounded-full bg-rose-100 overflow-hidden"><div className="h-full bg-gradient-to-r from-rose-400 to-rose-500 rounded-full" style={{ width: scans.length ? `${(phishingCount / scans.length) * 100}%` : '0%' }} /></div>
            </div>
            <div className="bg-white rounded-2xl p-4 border border-amber-100 shadow-card hover:shadow-glow-amber transition-all duration-300">
              <div className="text-[10px] font-bold uppercase tracking-widest text-amber-500 mb-1">Suspicious</div>
              <div className="text-3xl font-black text-amber-600">{suspiciousCount}</div>
              <div className="mt-2 h-1 rounded-full bg-amber-100 overflow-hidden"><div className="h-full bg-gradient-to-r from-amber-400 to-amber-500 rounded-full" style={{ width: scans.length ? `${(suspiciousCount / scans.length) * 100}%` : '0%' }} /></div>
            </div>
            <div className="bg-white rounded-2xl p-4 border border-emerald-100 shadow-card hover:shadow-glow-emerald transition-all duration-300">
              <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-500 mb-1">Safe</div>
              <div className="text-3xl font-black text-emerald-600">{safeCount}</div>
              <div className="mt-2 h-1 rounded-full bg-emerald-100 overflow-hidden"><div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500 rounded-full" style={{ width: scans.length ? `${(safeCount / scans.length) * 100}%` : '0%' }} /></div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <section className="lg:col-span-5">
            <div className="bg-white rounded-3xl border border-gray-100 shadow-card overflow-hidden">
              {/* Vibrant color-coded tabs */}
              <div className="flex border-b border-gray-100">
                {TABS.map((tab) => {
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => { setActiveTab(tab.id); setResult(null); setError(""); setUploadedFile(null); setUploadedPreview(null); }}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-3.5 text-xs font-bold transition-all duration-300 border-b-2 ${
                        isActive
                          ? `${tab.activeBg} ${tab.color} ${tab.activeBorder}`
                          : "border-transparent text-gray-400 hover:text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      <tab.icon className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">{tab.label}</span>
                    </button>
                  );
                })}
              </div>

              <form onSubmit={handleSubmit} className="p-6">
                {(activeTab === "url" || activeTab === "message" || activeTab === "email") && (
                  <>
                    <label className="text-xs font-bold text-gray-600 uppercase tracking-wider">
                      {activeTab === "url" ? "URL" : activeTab === "email" ? "Email Content" : "Message"}
                    </label>
                    <div className="mt-2 relative group">
                      {activeTab === "url" && <Link2 className={`absolute left-3.5 top-3 h-4 w-4 ${TAB_COLORS[activeTab].icon} transition-colors`} />}
                      {(activeTab === "message" || activeTab === "email") && <MessageSquare className={`absolute left-3.5 top-3 h-4 w-4 ${TAB_COLORS[activeTab].icon} transition-colors`} />}
                      {activeTab === "url" ? (
                        <input
                          data-testid="url-input"
                          value={url}
                          onChange={(e) => setUrl(e.target.value)}
                          placeholder="https://example.com/login"
                          className={`w-full bg-gray-50/80 border border-gray-200 rounded-xl pl-10 pr-4 py-3 text-gray-900 font-mono text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 ${TAB_COLORS[activeTab].ring} transition-all`}
                        />
                      ) : (
                        <textarea
                          data-testid="message-input"
                          value={message}
                          // The API accepts 5000 characters; capping here turns a
                          // paste of a very long email into a visible hint
                          // instead of a raw 422 on submit.
                          maxLength={5000}
                          onChange={(e) => setMessage(e.target.value)}
                          rows={5}
                          placeholder={activeTab === "email" ? "Paste the full email content here..." : "Paste the suspicious message here..."}
                          className={`w-full bg-gray-50/80 border border-gray-200 rounded-xl pl-10 pr-4 py-3 text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 ${TAB_COLORS[activeTab].ring} transition-all resize-y`}
                        />
                      )}
                      {message.length >= 4900 && (
                        <p className="mt-1 text-[11px] font-semibold text-amber-600">
                          {message.length}/5000 characters. Long messages are translated in
                          parts, which takes a few seconds.
                        </p>
                      )}
                    </div>
                  </>
                )}

                {(activeTab === "email" || activeTab === "message") && (
                  <button type="button" onClick={activeTab === "email" ? loadSampleEmail : () => { setMessage("URGENT: Your OTP will expire! Verify at http://bit.ly/fake-link NOW!"); }}
                    className="mt-2 text-[11px] font-bold text-amber-500 hover:text-amber-600 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg px-3 py-1.5 transition-all">
                    Load Sample {activeTab === "email" ? "Phishing Email" : "Phishing Message"}
                  </button>
                )}

                {activeTab === "url" && <UrlPreview url={url} />}
                {(activeTab === "message" || activeTab === "email") && <MessagePreview message={message} type={activeTab} />}

                {activeTab === "file" && (
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleFileDrop}
                    className="border-2 border-dashed border-emerald-200 rounded-2xl p-8 text-center hover:border-emerald-400 hover:bg-emerald-50/30 transition-all duration-300 cursor-pointer"
                    onClick={() => fileRef.current?.click()}
                  >
                    <input ref={fileRef} type="file" accept=".txt,.csv,.html,.eml" className="hidden" onChange={handleFileDrop} />
                    {uploadedFile ? (
                      <div className="space-y-2">
                        <CheckCircle className="h-10 w-10 text-emerald-500 mx-auto" />
                        <div className="text-sm font-bold text-gray-900">{uploadedFile.name}</div>
                        <div className="text-xs text-gray-500 font-mono">{(uploadedFile.size / 1024).toFixed(1)} KB</div>
                        <button type="button" onClick={(e) => { e.stopPropagation(); setUploadedFile(null); }} className="text-xs text-rose-500 hover:text-rose-600 font-bold">Remove</button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="h-14 w-14 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center mx-auto">
                          <Upload className="h-6 w-6 text-emerald-400" />
                        </div>
                        <div className="text-sm font-bold text-gray-700">Drop a file here or click to browse</div>
                        <div className="text-xs text-gray-400">Supports .txt, .csv, .html, .eml (max 1MB)</div>
                      </div>
                    )}
                  </div>
                )}

                {activeTab === "file" && uploadedFile && <FilePreview file={uploadedFile} />}

                {activeTab === "file" && !uploadedFile && (
                  <button type="button" onClick={loadSampleFile}
                    className="mt-3 text-[11px] font-bold text-emerald-500 hover:text-emerald-600 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg px-3 py-1.5 transition-all">
                    Load Sample Phishing File
                  </button>
                )}

                {activeTab === "image" && (
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleFileDrop}
                    className="border-2 border-dashed border-rose-200 rounded-2xl p-8 text-center hover:border-rose-400 hover:bg-rose-50/30 transition-all duration-300 cursor-pointer"
                    onClick={() => imageRef.current?.click()}
                  >
                    <input ref={imageRef} type="file" accept="image/*" className="hidden" onChange={handleFileDrop} />
                    {uploadedPreview ? (
                      <div className="space-y-3">
                        <img src={uploadedPreview} alt="Preview" className="max-h-40 mx-auto rounded-xl border border-gray-200 shadow-card" />
                        <div className="text-sm font-bold text-gray-900">{uploadedFile?.name}</div>
                        <button type="button" onClick={(e) => { e.stopPropagation(); setUploadedFile(null); setUploadedPreview(null); }} className="text-xs text-rose-500 hover:text-rose-600 font-bold">Remove</button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="h-14 w-14 rounded-2xl bg-rose-50 border border-rose-200 flex items-center justify-center mx-auto">
                          <Image className="h-6 w-6 text-rose-400" />
                        </div>
                        <div className="text-sm font-bold text-gray-700">Drop an image or click to browse</div>
                        <div className="text-xs text-gray-400">OCR extracts text from screenshots of scam messages</div>
                      </div>
                    )}
                  </div>
                )}

                {activeTab === "image" && <ImagePreview preview={uploadedPreview} file={uploadedFile} />}

                {activeTab === "qr" && (
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleFileDrop}
                    className="border-2 border-dashed border-teal-200 rounded-2xl p-8 text-center hover:border-teal-400 hover:bg-teal-50/30 transition-all duration-300 cursor-pointer"
                    onClick={() => qrRef.current?.click()}
                  >
                    <input ref={qrRef} type="file" accept="image/*" className="hidden" onChange={handleFileDrop} />
                    {uploadedPreview ? (
                      <div className="space-y-3">
                        <img src={uploadedPreview} alt="QR preview" className="max-h-40 mx-auto rounded-xl border border-gray-200 shadow-card" />
                        <div className="text-sm font-bold text-gray-900">{uploadedFile?.name}</div>
                        <button type="button" onClick={(e) => { e.stopPropagation(); setUploadedFile(null); setUploadedPreview(null); }} className="text-xs text-teal-600 hover:text-teal-700 font-bold">Remove</button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="h-14 w-14 rounded-2xl bg-teal-50 border border-teal-200 flex items-center justify-center mx-auto">
                          <QrCode className="h-6 w-6 text-teal-500" />
                        </div>
                        <div className="text-sm font-bold text-gray-700">Drop a QR code image or click to browse</div>
                        <div className="text-xs text-gray-400">The hidden link is decoded and checked against the URL model</div>
                      </div>
                    )}
                  </div>
                )}

                {activeTab === "qr" && !uploadedFile && (
                  <button type="button" onClick={loadSampleQr}
                    className="mt-3 text-[11px] font-bold text-teal-600 hover:text-teal-700 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg px-3 py-1.5 transition-all">
                    Load Sample Phishing QR Code
                  </button>
                )}

                {activeTab === "qr" && (
                  <div className="mt-3 rounded-xl border border-teal-100 bg-teal-50/50 px-3 py-2">
                    <div className="text-[11px] font-bold text-teal-700">Tips for a reliable scan</div>
                    <ul className="mt-1 list-inside list-disc text-[11px] leading-relaxed text-teal-600/90">
                      <li>Crop tightly around the code if the photo is busy</li>
                      <li>Flat, even lighting beats shadows and glare</li>
                      <li>Screenshots and photos both work, including rotated ones</li>
                    </ul>
                  </div>
                )}

                {activeTab === "image" && !uploadedFile && (
                  <button type="button" onClick={loadSampleImage}
                    className="mt-3 text-[11px] font-bold text-rose-500 hover:text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg px-3 py-1.5 transition-all">
                    Load Sample Phishing Screenshot
                  </button>
                )}

                {error && (
                  <div data-testid="predict-error" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 text-rose-600 text-sm px-4 py-3 font-medium flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-rose-500 flex-none" />{error}
                  </div>
                )}

                <button
                  data-testid="scan-button"
                  type="submit"
                  disabled={empty || loading}
                  className="mt-5 w-full gradient-brand text-white font-bold rounded-xl px-5 py-3.5 hover:shadow-glow-brand disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 transition-all duration-300 text-sm"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scan className="h-4 w-4" />}
                  {loading ? "Scanning..." : "Scan Now"}
                </button>

                <div className="mt-6 pt-5 border-t border-gray-100">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">Try an example</div>
                  <div className="flex flex-wrap gap-2">
                    {EXAMPLES.map((ex) => (
                      <button key={ex.label} type="button" data-testid={`example-${ex.label.toLowerCase()}`}
                        onClick={() => loadExample(ex)}
                        className={`text-xs font-bold rounded-xl px-4 py-1.5 text-white transition-all duration-300 hover:scale-105 ${ex.gradient}`}
                      >{ex.label}</button>
                    ))}
                  </div>
                </div>
              </form>
            </div>
          </section>

          <section className="lg:col-span-7 space-y-6">
            {loading && (
              <div data-testid="loading-state" className="bg-white rounded-3xl border border-gray-100 shadow-card p-12 flex flex-col items-center justify-center min-h-[300px]">
                <div className="relative">
                  <div className="h-16 w-16 rounded-full border-2 border-violet-100" />
                  <div className="absolute inset-0 rounded-full border-t-2 border-violet-500 animate-spin" />
                  <div className="absolute inset-2 rounded-full border-t-2 border-coral-400 animate-spin" style={{ animationDirection: "reverse", animationDuration: "1.5s" }} />
                </div>
                <div className="mt-5 text-sm font-bold text-gradient animate-pulse">Analyzing threat...</div>
              </div>
            )}

            {!loading && result && (
            <ResultCard
              result={result}
              languages={languages}
              onTranslate={() => setLangOpen((v) => !v)}
              translating={translating}
              translation={translation}
              translationError={translationError}
              translationRef={translationRef}
            />
          )}

          {langOpen && languages.length > 0 && (
            <div ref={langMenuRef} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-elevated">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-bold uppercase tracking-widest text-slate-500">
                  Translate into which language?
                </div>
                <button type="button" onClick={() => setLangOpen(false)}
                  className="text-slate-400 transition hover:text-slate-700" aria-label="Close">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {languages.map((l) => (
                  <button
                    key={l.code}
                    type="button"
                    onClick={() => translateTo(l.code)}
                    className={`flex flex-col items-start rounded-xl border px-3 py-2 text-left transition ${
                      langTarget === l.code
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-200 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50"
                    }`}
                  >
                    <span className="text-xs font-bold">{l.native}</span>
                    <span className={`text-[10px] ${langTarget === l.code ? "text-white/70" : "text-slate-400"}`}>
                      {l.name}
                    </span>
                  </button>
                ))}
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
                The verdict and risk reasons stay in English so they always match the model output.
              </p>
            </div>
          )}

            {!loading && !result && (
              <div className="bg-white rounded-3xl border border-dashed border-gray-200 p-12 min-h-[300px] flex flex-col items-center justify-center text-center">
                <div className="h-16 w-16 rounded-2xl gradient-aurora flex items-center justify-center shadow-elevated animate-pulse-slow">
                  <Radar className="h-7 w-7 text-white" strokeWidth={1.5} />
                </div>
                <div className="mt-5 text-lg font-extrabold text-gray-700">Awaiting input</div>
                <div className="mt-2 text-sm text-gray-400 max-w-sm leading-relaxed">
                  Choose an input tab and paste or upload content. ScamSense will score the risk and explain why.
                </div>
              </div>
            )}

            {/* Scan History */}
            <div className="bg-white rounded-3xl border border-gray-100 shadow-card p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 text-gray-400" />
                  <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Recent Scans</div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={exportCsv}
                    disabled={scans.length === 0}
                    className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-semibold text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Download className="h-3 w-3" />
                    Export
                  </button>
                  <button
                    onClick={clearHistory}
                    disabled={scans.length === 0 || clearing}
                    className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-semibold text-gray-600 transition-colors hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {clearing ? "Clearing…" : "Clear"}
                  </button>
                </div>
              </div>

              {scans.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <div className="flex items-center gap-1 rounded-xl bg-gray-50 p-1">
                    {["All", "Phishing", "Suspicious", "Safe"].map((f) => {
                      const n = f === "All" ? scans.length : scans.filter((s) => s.verdict === f).length;
                      const active = historyFilter === f;
                      return (
                        <button
                          key={f}
                          onClick={() => setHistoryFilter(f)}
                          className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-all ${
                            active ? "bg-white text-gray-900 shadow-card" : "text-gray-500 hover:text-gray-700"
                          }`}
                        >
                          {f} <span className="font-mono text-[10px] text-gray-400">{n}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="relative flex-1 min-w-[140px]">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400" />
                    <input
                      value={historyQuery}
                      onChange={(e) => setHistoryQuery(e.target.value)}
                      placeholder="Search history…"
                      className="w-full rounded-xl border border-gray-200 bg-white py-1.5 pl-7 pr-2 text-xs text-gray-700 outline-none transition-colors placeholder:text-gray-400 focus:border-violet-400"
                    />
                  </div>
                </div>
              )}

              {scans.length === 0 ? (
                <div className="text-sm text-gray-400 text-center py-6">No scans yet. Start scanning above.</div>
              ) : visibleScans.length === 0 ? (
                <div className="text-sm text-gray-400 text-center py-6">No scans match this filter.</div>
              ) : (
                <ul data-testid="scan-history" className="space-y-1 max-h-80 overflow-y-auto">
                  {visibleScans.map((s) => {
                    const dotColor = s.verdict === "Phishing" ? "bg-rose-500" : s.verdict === "Suspicious" ? "bg-amber-500" : "bg-emerald-500";
                    const textColor = s.verdict === "Phishing" ? "text-rose-600" : s.verdict === "Suspicious" ? "text-amber-600" : "text-emerald-600";
                    return (
                      <li key={s.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-50 transition-all group">
                        <div className={`h-2 w-2 rounded-full flex-none ${dotColor}`} />
                        <span className={`text-xs font-bold w-20 flex-none ${textColor}`}>{s.verdict}</span>
                        <span className="text-xs text-gray-400 font-mono w-12 flex-none">{Math.round((s.risk_score ?? 0) * 100)}%</span>
                        <span className="text-xs text-gray-500 truncate flex-1">{s.url || s.message?.slice(0, 80) || "—"}</span>
                        <button
                          onClick={() => removeScan(s.id)}
                          aria-label="Delete scan"
                          className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity flex-none rounded-lg p-1 text-gray-300 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>
        </div>
      </main>

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 animate-fade-in">
          <div className="rounded-xl bg-gray-900 px-4 py-2.5 text-xs font-semibold text-white shadow-lg">
            {toast}
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useCallback, useRef } from "react";
import {
  Link2, MessageSquare, Loader2, ShieldCheck, LogOut, Radar, History,
  Shield, ShieldX, AlertTriangle, Clock, Upload, FileText, Image, Mail,
  ArrowUpRight, Zap, X, CheckCircle, Scan,
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

function createSampleImage(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 700;
  canvas.height = 200;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 700, 200);
  ctx.fillStyle = "#cc0000";
  ctx.font = "bold 20px Arial";
  const lines = text.split("\n");
  lines.forEach((line, i) => {
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
  const fileRef = useRef(null);
  const imageRef = useRef(null);

  const loadScans = useCallback(async () => {
    try {
      const { data } = await api.get("/scans");
      setScans(data);
    } catch { /* ignore */ }
  }, []);

  useState(() => { loadScans(); }, []);

  const reset = () => { setUrl(""); setMessage(""); setResult(null); setError(""); setUploadedFile(null); setUploadedPreview(null); };

  const submitText = async (e) => {
    e.preventDefault();
    if (activeTab === "file" || activeTab === "image") return;
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
                          onChange={(e) => setMessage(e.target.value)}
                          rows={5}
                          placeholder={activeTab === "email" ? "Paste the full email content here..." : "Paste the suspicious message here..."}
                          className={`w-full bg-gray-50/80 border border-gray-200 rounded-xl pl-10 pr-4 py-3 text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 ${TAB_COLORS[activeTab].ring} transition-all resize-y`}
                        />
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

            {!loading && result && <ResultCard result={result} />}

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
                <span className="text-[10px] font-mono text-gray-400">{scans.length} total</span>
              </div>
              {scans.length === 0 ? (
                <div className="text-sm text-gray-400 text-center py-6">No scans yet. Start scanning above.</div>
              ) : (
                <ul data-testid="scan-history" className="space-y-1">
                  {scans.map((s) => {
                    const dotColor = s.verdict === "Phishing" ? "bg-rose-500" : s.verdict === "Suspicious" ? "bg-amber-500" : "bg-emerald-500";
                    const textColor = s.verdict === "Phishing" ? "text-rose-600" : s.verdict === "Suspicious" ? "text-amber-600" : "text-emerald-600";
                    return (
                      <li key={s.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-50 transition-all group cursor-default">
                        <div className={`h-2 w-2 rounded-full flex-none ${dotColor}`} />
                        <span className={`text-xs font-bold w-20 flex-none ${textColor}`}>{s.verdict}</span>
                        <span className="text-xs text-gray-400 font-mono w-12 flex-none">{Math.round((s.risk_score ?? 0) * 100)}%</span>
                        <span className="text-xs text-gray-500 truncate flex-1">{s.url || s.message?.slice(0, 80) || "—"}</span>
                        <ArrowUpRight className="h-3 w-3 text-gray-300 group-hover:text-violet-500 transition-colors flex-none" />
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

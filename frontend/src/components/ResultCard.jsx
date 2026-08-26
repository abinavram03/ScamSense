import { ShieldCheck, AlertTriangle, ShieldX, BadgeInfo, ExternalLink, FileText, Scan, Info } from "lucide-react";

const VERDICTS = {
  Safe: {
    bg: "bg-emerald-50",
    border: "border-emerald-200",
    text: "text-emerald-700",
    gradient: "gradient-mint",
    icon: ShieldCheck,
    ring: "text-emerald-500",
    bar: "bg-gradient-to-r from-emerald-400 to-emerald-500",
    glow: "shadow-glow-emerald",
    label: "Low Risk",
    range: "0 – 39%",
    color: "text-emerald-600",
    bgLight: "bg-emerald-50",
    borderLight: "border-emerald-200",
  },
  Suspicious: {
    bg: "bg-amber-50",
    border: "border-amber-200",
    text: "text-amber-700",
    gradient: "gradient-sunset",
    icon: AlertTriangle,
    ring: "text-amber-500",
    bar: "bg-gradient-to-r from-amber-400 to-amber-500",
    glow: "shadow-glow-amber",
    label: "Moderate Risk",
    range: "40 – 57%",
    color: "text-amber-600",
    bgLight: "bg-amber-50",
    borderLight: "border-amber-200",
  },
  Phishing: {
    bg: "bg-rose-50",
    border: "border-rose-200",
    text: "text-rose-700",
    gradient: "gradient-sunset",
    icon: ShieldX,
    ring: "text-rose-500",
    bar: "bg-gradient-to-r from-rose-400 to-rose-500",
    glow: "shadow-glow-rose",
    label: "High Risk",
    range: "58 – 100%",
    color: "text-rose-600",
    bgLight: "bg-rose-50",
    borderLight: "border-rose-200",
  },
  Unknown: {
    bg: "bg-gray-50",
    border: "border-gray-200",
    text: "text-gray-600",
    gradient: "gradient-brand",
    icon: BadgeInfo,
    ring: "text-gray-500",
    bar: "bg-gradient-to-r from-gray-400 to-gray-500",
    glow: "shadow-card",
    label: "Unknown",
    range: "N/A",
    color: "text-gray-600",
    bgLight: "bg-gray-50",
    borderLight: "border-gray-200",
  },
};

function getRiskExplanation(v, percent, result) {
  const urlReasons = result?.url_reasons || [];
  const msgReasons = result?.message_reasons || [];
  const urlShap = result?.url_shap_features || [];
  const msgShap = result?.message_shap_features || [];
  const urlProb = result?.url_probability ?? 0;
  const msgProb = result?.message_probability ?? 0;
  const thresholds = result?.thresholds || { safe: 0.4, phishing: 0.58 };
  const hasUrl = urlShap.length > 0 || urlReasons.length > 0;
  const hasMsg = msgShap.length > 0 || msgReasons.length > 0;

  if (v === "Safe") {
    const parts = [];
    if (hasUrl) {
      if (urlProb < thresholds.safe) {
        const topFeature = urlShap[0];
        if (topFeature) {
          parts.push(`The URL model scored ${Math.round(urlProb * 100)}% — the strongest SHAP signal was "${topFeature.feature}" (value: ${topFeature.value}, contribution: +${Math.round(topFeature.contribution * 100)}%), which is not a strong phishing indicator.`);
        } else {
          parts.push(`The URL model scored ${Math.round(urlProb * 100)}% — no significant phishing features were detected by SHAP analysis.`);
        }
      }
    }
    if (hasMsg) {
      if (msgProb < thresholds.safe) {
        const topFeature = msgShap[0];
        if (topFeature) {
          parts.push(`The message model scored ${Math.round(msgProb * 100)}% — the top SHAP token "${topFeature.feature}" contributed only +${Math.round(topFeature.contribution * 100)}%, well within safe limits.`);
        } else {
          parts.push(`The message model scored ${Math.round(msgProb * 100)}% — no suspicious tokens were flagged by SHAP analysis.`);
        }
      }
    }
    if (parts.length === 0) {
      return `This input scored ${percent}% — well below the ${Math.round(thresholds.safe * 100)}% "Safe" threshold. The SHAP TreeExplainer found no features contributing strongly toward phishing.`;
    }
    return `This input scored ${percent}% — below the ${Math.round(thresholds.safe * 100)}% "Safe" threshold. ${parts.join(" ")}`;
  }

  if (v === "Suspicious") {
    const parts = [];
    if (hasUrl && urlReasons.length > 0) {
      const topFeature = urlShap[0];
      parts.push(`The URL model scored ${Math.round(urlProb * 100)}% — SHAP identified "${topFeature?.feature || urlReasons[0]}" as the top contributor (value: ${topFeature?.value}, +${topFeature ? Math.round(topFeature.contribution * 100) : "?"}%)`);
    }
    if (hasMsg && msgReasons.length > 0) {
      const topFeature = msgShap[0];
      parts.push(`The message model scored ${Math.round(msgProb * 100)}% — SHAP flagged "${topFeature?.feature || msgReasons[0]}" (value: ${topFeature?.value}, +${topFeature ? Math.round(topFeature.contribution * 100) : "?"}%)`);
    }
    if (parts.length === 0) {
      return `This input scored ${percent}% — falling in the ${Math.round(thresholds.safe * 100)}–${Math.round(thresholds.phishing * 100)}% "Suspicious" zone. Some SHAP features contributed toward phishing but none were strong enough to cross the threshold.`;
    }
    return `This input scored ${percent}% — in the ${Math.round(thresholds.safe * 100)}–${Math.round(thresholds.phishing * 100)}% "Suspicious" zone. ${parts.join(". ")}. Exercise caution.`;
  }

  if (v === "Phishing") {
    const parts = [];
    if (hasUrl) {
      const topFeatures = urlShap.slice(0, 2);
      if (topFeatures.length > 0) {
        parts.push(`The URL model scored ${Math.round(urlProb * 100)}% — SHAP's top ${topFeatures.length} phishing signals: ${topFeatures.map(f => `"${f.feature}" (+${Math.round(f.contribution * 100)}%)`).join(", ")}`);
      } else if (urlReasons.length > 0) {
        parts.push(`The URL model scored ${Math.round(urlProb * 100)}% — ${urlReasons[0]}`);
      }
    }
    if (hasMsg) {
      const topFeatures = msgShap.slice(0, 2);
      if (topFeatures.length > 0) {
        parts.push(`The message model scored ${Math.round(msgProb * 100)}% — SHAP's top phishing tokens: ${topFeatures.map(f => `"${f.feature}" (+${Math.round(f.contribution * 100)}%)`).join(", ")}`);
      } else if (msgReasons.length > 0) {
        parts.push(`The message model scored ${Math.round(msgProb * 100)}% — ${msgReasons[0]}`);
      }
    }
    if (parts.length === 0) {
      return `This input scored ${percent}% — above the ${Math.round(thresholds.phishing * 100)}% "Phishing" threshold. The SHAP TreeExplainer found multiple features contributing strongly toward phishing.`;
    }
    return `This input scored ${percent}% — above the ${Math.round(thresholds.phishing * 100)}% "Phishing" threshold. ${parts.join(". ")}. Do not interact with this content.`;
  }

  return "Unable to determine risk level for this input.";
}

export default function ResultCard({ result }) {
  const v = result?.verdict || "Unknown";
  const config = VERDICTS[v] || VERDICTS.Unknown;
  const Icon = config.icon;
  const score = Math.max(0, Math.min(1, result?.risk_score ?? 0));
  const percent = Math.round(score * 100);
  const reasons = result?.reasons || [];
  const extractedText = result?.extracted_text;
  const urlShap = result?.url_shap_features || [];
  const msgShap = result?.message_shap_features || [];

  const circumference = 2 * Math.PI * 54;
  const dashoffset = circumference - score * circumference;

  const explanation = getRiskExplanation(v, percent, result);

  return (
    <div data-testid="result-card" className="animate-slide-up">
      <div className={`rounded-3xl border ${config.border} shadow-elevated overflow-hidden`}>
        {/* Gradient header */}
        <div className={`${config.gradient} px-6 py-5 flex items-center gap-4`}>
          <div className="h-14 w-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
            <Icon className="h-7 w-7 text-white" strokeWidth={2} />
          </div>
          <div className="flex-1">
            <div className="text-[10px] font-bold uppercase tracking-widest text-white/70">Verdict</div>
            <div className="text-2xl font-black text-white leading-none mt-1">{v}</div>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Score + extracted text row */}
          <div className="flex items-start gap-6">
            {/* Circular gauge */}
            <div className="flex-none">
              <div className="relative w-28 h-28">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
                  <circle cx="60" cy="60" r="54" fill="none" stroke="currentColor" className="text-gray-100" strokeWidth="10" />
                  <circle
                    cx="60" cy="60" r="54" fill="none" stroke="url(#gauge-grad)" strokeWidth="10"
                    strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={dashoffset}
                    className="transition-all duration-1000 ease-out"
                  />
                  <defs>
                    <linearGradient id="gauge-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" className="text-emerald-400" stopColor="currentColor" />
                      <stop offset="50%" className="text-amber-400" stopColor="currentColor" />
                      <stop offset="100%" className="text-rose-500" stopColor="currentColor" />
                    </linearGradient>
                  </defs>
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-black text-gray-900">{percent}</span>
                  <span className="text-[10px] font-bold text-gray-400 uppercase">risk %</span>
                </div>
              </div>
            </div>

            {/* Meta info */}
            <div className="flex-1 space-y-2">
              {result?.model_used && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Model</span>
                  <span className="text-xs font-mono font-bold text-gray-700 bg-gray-100 px-2 py-0.5 rounded-md">{result.model_used}</span>
                </div>
              )}
              {(result?.url_probability > 0 || result?.message_probability > 0) && (
                <div className="flex items-center gap-3 flex-wrap">
                  {result?.url_probability > 0 && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">URL Model</span>
                      <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded-md ${
                        result.url_probability >= (result?.thresholds?.phishing ?? 0.58) ? 'bg-rose-100 text-rose-600' :
                        result.url_probability >= (result?.thresholds?.safe ?? 0.4) ? 'bg-amber-100 text-amber-600' :
                        'bg-emerald-100 text-emerald-600'
                      }`}>{Math.round(result.url_probability * 100)}%</span>
                    </div>
                  )}
                  {result?.message_probability > 0 && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Msg Model</span>
                      <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded-md ${
                        result.message_probability >= (result?.thresholds?.phishing ?? 0.58) ? 'bg-rose-100 text-rose-600' :
                        result.message_probability >= (result?.thresholds?.safe ?? 0.4) ? 'bg-amber-100 text-amber-600' :
                        'bg-emerald-100 text-emerald-600'
                      }`}>{Math.round(result.message_probability * 100)}%</span>
                    </div>
                  )}
                </div>
              )}
              {result?.scanned_url && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">URL</span>
                  <a href={result.scanned_url} target="_blank" rel="noreferrer"
                    className="text-xs font-mono font-bold text-violet-600 hover:text-violet-700 truncate flex items-center gap-1 max-w-[280px]">
                    {result.scanned_url} <ExternalLink className="h-3 w-3 flex-none" />
                  </a>
                </div>
              )}
              {result?.message_preview && (
                <div className="flex items-start gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 flex-none">Message</span>
                  <span className="text-xs text-gray-600 line-clamp-3 leading-relaxed">"{result.message_preview}"</span>
                </div>
              )}
              {result?.filename && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">File</span>
                  <span className="text-xs font-mono font-bold text-gray-700 bg-gray-100 px-2 py-0.5 rounded-md flex items-center gap-1">
                    <FileText className="h-3 w-3 text-gray-400" />{result.filename}
                  </span>
                </div>
              )}
              {result?.scan_type && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Type</span>
                  <span className="text-xs font-mono font-bold text-gray-700 bg-gray-100 px-2 py-0.5 rounded-md flex items-center gap-1">
                    <Scan className="h-3 w-3 text-gray-400" />{result.scan_type}
                  </span>
                </div>
              )}
              {result?.warning && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-700 text-xs px-3 py-2 font-medium mt-2">
                  {result.warning}
                </div>
              )}
            </div>
          </div>

          {/* Risk Explanation */}
          <div className={`rounded-2xl border ${config.borderLight} ${config.bgLight} p-5`}>
            <div className="flex items-center gap-2 mb-2.5">
              <Info className={`h-4 w-4 ${config.color}`} />
              <span className={`text-xs font-bold uppercase tracking-wider ${config.color}`}>Risk Assessment — Why {config.label}</span>
            </div>
            <p className="text-sm text-gray-700 leading-relaxed">{explanation}</p>
            <div className="mt-3 flex items-center gap-3 text-[10px] font-mono text-gray-400">
              <span>Safe &lt; {Math.round((result?.thresholds?.safe ?? 0.4) * 100)}%</span>
              <span className="text-gray-300">|</span>
              <span>Suspicious {Math.round((result?.thresholds?.safe ?? 0.4) * 100)}–{Math.round((result?.thresholds?.phishing ?? 0.58) * 100)}%</span>
              <span className="text-gray-300">|</span>
              <span>Phishing &gt; {Math.round((result?.thresholds?.phishing ?? 0.58) * 100)}%</span>
            </div>
          </div>

          {/* SHAP Feature Breakdown */}
          {(urlShap.length > 0 || msgShap.length > 0) && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">SHAP Feature Contributions</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {urlShap.length > 0 && (
                  <div className="rounded-xl border border-violet-100 bg-violet-50/50 p-3">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-violet-500 mb-2">URL Model</div>
                    <ul className="space-y-1.5">
                      {urlShap.map((f, i) => (
                        <li key={i} className="flex items-center gap-2 text-xs">
                          <span className="font-mono font-bold text-gray-700 truncate flex-1">{f.feature}</span>
                          <span className="font-mono text-violet-600 flex-none">+{Math.round(f.contribution * 100)}%</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {msgShap.length > 0 && (
                  <div className="rounded-xl border border-sky-100 bg-sky-50/50 p-3">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-sky-500 mb-2">Message Model</div>
                    <ul className="space-y-1.5">
                      {msgShap.map((f, i) => (
                        <li key={i} className="flex items-center gap-2 text-xs">
                          <span className="font-mono font-bold text-gray-700 truncate flex-1">"{f.feature}"</span>
                          <span className="font-mono text-sky-600 flex-none">+{Math.round(f.contribution * 100)}%</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Reason list */}
          {reasons.length > 0 && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">Explainability</div>
              <ul className="space-y-2">
                {reasons.map((r, i) => {
                  const isPos = r.type === "positive";
                  const labelColor = isPos ? "text-emerald-600 bg-emerald-50 border-emerald-200" : "text-rose-600 bg-rose-50 border-rose-200";
                  const barColor = isPos
                    ? "bg-gradient-to-r from-emerald-400 to-emerald-500"
                    : "bg-gradient-to-r from-rose-400 to-rose-500";
                  const weight = Math.round((r.weight ?? 0.5) * 100);
                  return (
                    <li key={i} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 px-4 py-2.5 opacity-0 animate-fade-in" style={{ animationDelay: `${i * 0.08}s` }}>
                      <span className={`text-[10px] font-bold uppercase w-16 flex-none px-2 py-0.5 rounded-md border ${labelColor}`}>
                        {isPos ? "Risk ↑" : "Safe ↓"}
                      </span>
                      <span className="text-xs text-gray-700 flex-1 font-medium">{r.reason}</span>
                      <span className="text-[10px] font-mono text-gray-400 flex-none">{weight}%</span>
                      <div className="w-16 h-1.5 rounded-full bg-gray-200 overflow-hidden flex-none">
                        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${weight}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Extracted text from OCR / file */}
          {extractedText && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Extracted text</div>
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 max-h-48 overflow-y-auto font-mono text-xs text-gray-600 leading-relaxed whitespace-pre-wrap">
                {extractedText}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

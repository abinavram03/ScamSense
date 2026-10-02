import {
  Globe,
  Link2,
  CalendarDays,
  Server,
  Network,
  ListChecks,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  MinusCircle,
  PlusCircle,
} from "lucide-react";

// Provider keys come straight from the backend `reputation.providers` object.
const PROVIDERS = [
  { key: "safe_browsing", label: "Google Safe Browsing", icon: ShieldAlert },
  { key: "virustotal", label: "VirusTotal", icon: Network },
  { key: "openphish", label: "OpenPhish feed", icon: ListChecks },
  { key: "rdap", label: "Domain registration", icon: CalendarDays },
  { key: "dns", label: "DNS", icon: Server },
  { key: "redirects", label: "Redirect trace", icon: Link2 },
];

const STATUS_STYLE = {
  unsafe: { cls: "bg-rose-100 text-rose-700 border-rose-200", icon: XCircle, text: "Flagged as unsafe" },
  flagged: { cls: "bg-rose-100 text-rose-700 border-rose-200", icon: XCircle, text: "Flagged" },
  no_dns: { cls: "bg-rose-100 text-rose-700 border-rose-200", icon: XCircle, text: "Does not resolve" },
  listed: { cls: "bg-rose-100 text-rose-700 border-rose-200", icon: XCircle, text: "Listed in feed" },
  clean: { cls: "bg-emerald-100 text-emerald-700 border-emerald-200", icon: CheckCircle2, text: "Clean" },
  ok: { cls: "bg-emerald-100 text-emerald-700 border-emerald-200", icon: CheckCircle2, text: "Checked" },
  resolves: { cls: "bg-emerald-100 text-emerald-700 border-emerald-200", icon: CheckCircle2, text: "Resolves" },
  not_found: { cls: "bg-gray-100 text-gray-600 border-gray-200", icon: MinusCircle, text: "No record" },
  not_configured: { cls: "bg-gray-100 text-gray-500 border-gray-200", icon: MinusCircle, text: "No API key" },
  unreachable: { cls: "bg-amber-100 text-amber-700 border-amber-200", icon: AlertTriangle, text: "Unreachable" },
  error: { cls: "bg-amber-100 text-amber-700 border-amber-200", icon: AlertTriangle, text: "Error" },
};

// A short human detail per provider, on top of the status pill.
function providerDetail(key, info) {
  if (!info) return "";
  switch (key) {
    case "safe_browsing":
      return info.threat_types?.length ? info.threat_types.join(", ").replace(/_/g, " ").toLowerCase() : "";
    case "virustotal":
      return typeof info.malicious === "number" ? `${info.malicious} of ${info.total} engines flagged` : "";
    case "openphish":
      return info.feed_size ? `feed: ${info.feed_size.toLocaleString()} domains` : "";
    case "rdap": {
      const bits = [];
      if (info.registrar) bits.push(info.registrar);
      if (typeof info.age_days === "number") {
        const y = Math.floor(info.age_days / 365);
        bits.push(y >= 1 ? `${y}y old` : `${info.age_days} days old`);
      }
      return bits.join(" · ");
    }
    case "dns":
      return info.ips?.length ? `${info.ips.length} address${info.ips.length > 1 ? "es" : ""}` : "";
    case "redirects":
      if (info.crosses_domain) return `crosses to ${info.final_domain || "another domain"}`;
      if (info.downgraded_to_http) return "downgrades to plain HTTP";
      return typeof info.hops === "number" ? `${info.hops} hop${info.hops === 1 ? "" : "s"}` : "";
    default:
      return info.note || info.detail || "";
  }
}

function pct(v) {
  return `${Math.round((v ?? 0) * 100)}%`;
}

export default function DomainReputationPanel({ result }) {
  const rep = result?.reputation;
  if (!rep || !rep.domain) return null;

  const ml = result?.ml_risk_score;
  const final = result?.risk_score;
  const bump = result?.reputation_bump ?? rep.bump ?? 0;
  const signals = rep.signals || [];
  const providers = rep.providers || {};
  const notes = rep.notes || [];
  const hasScore = typeof ml === "number" && typeof final === "number";

  const maxPoints = rep.max_bump ? Math.round(rep.max_bump * 100) : 40;

  return (
    <div data-testid="domain-reputation" className="rounded-2xl border border-slate-200 bg-slate-50/60 p-5">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Globe className="h-4 w-4 text-slate-500" />
        <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
          Domain Reputation
        </span>
        <span className="font-mono text-xs font-bold text-slate-700 bg-white border border-slate-200 rounded-md px-2 py-0.5">
          {rep.domain}
        </span>
        {bump > 0 ? (
          <span className="rounded-full bg-amber-100 border border-amber-200 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700">
            +{Math.round(bump * 100)} risk points
          </span>
        ) : (
          <span className="rounded-full bg-emerald-100 border border-emerald-200 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
            No reputation concern
          </span>
        )}
      </div>

      {/* Risk engine arithmetic: ML score + reputation = final score */}
      {hasScore && (
        <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">
            How the final score was reached
          </div>
          <div className="flex items-center gap-3 flex-wrap text-xs">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                ML model
              </div>
              <div className="font-mono text-lg font-black text-slate-800">{pct(ml)}</div>
            </div>
            <div className="text-slate-300 text-lg">+</div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Reputation
              </div>
              <div
                className={`font-mono text-lg font-black ${
                  bump > 0 ? "text-amber-600" : "text-slate-400"
                }`}
              >
                {bump > 0 ? `+${Math.round(bump * 100)}` : "0"}
              </div>
            </div>
            <div className="text-slate-300 text-lg">=</div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Final score
              </div>
              <div className="font-mono text-lg font-black text-slate-900">{pct(final)}</div>
            </div>
          </div>

          {/* Stacked bar */}
          <div className="mt-3">
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500"
                style={{ width: `${Math.min(100, ml * 100)}%` }}
                title={`ML model ${pct(ml)}`}
              />
              <div
                className="h-full bg-gradient-to-r from-amber-400 to-amber-500"
                style={{ width: `${Math.min(100 - ml * 100, bump * 100)}%` }}
                title={`Reputation +${Math.round(bump * 100)}`}
              />
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              The ML score decides the baseline; reputation can add at most {maxPoints} points on
              top. It can never lower the score, and it can never push a safe domain into the high
              risk band on its own.
            </p>
          </div>
        </div>
      )}

      {/* Signals that contributed */}
      {signals.length > 0 && (
        <div className="mb-4">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">
            Reputation findings
          </div>
          <ul className="space-y-1.5">
            {signals.map((s, i) => (
              <li
                key={i}
                className="flex items-start gap-2 rounded-lg border border-amber-100 bg-amber-50/60 px-3 py-2 text-xs leading-relaxed text-amber-900"
              >
                <PlusCircle className="h-3.5 w-3.5 flex-none text-amber-600 mt-0.5" />
                <span className="flex-1">
                  {s.label}
                  <span className="ml-1 text-[10px] uppercase tracking-wider text-amber-600/70">
                    ({s.source})
                  </span>
                </span>
                <span className="flex-none font-mono font-bold text-amber-700">
                  +{Math.round(s.points)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Provider status grid */}
      <div>
        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">
          Sources checked
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {PROVIDERS.map(({ key, label, icon: Icon }) => {
            const info = providers[key];
            if (!info) return null;
            const style = STATUS_STYLE[info.status] || {
              cls: "bg-gray-100 text-gray-600 border-gray-200",
              icon: MinusCircle,
              text: info.status || "unknown",
            };
            const PillIcon = style.icon;
            const detail = providerDetail(key, info);
            return (
              <div
                key={key}
                className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5"
              >
                <Icon className="h-4 w-4 flex-none text-slate-400 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[11px] font-bold text-slate-700">{label}</span>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[9px] font-bold uppercase tracking-wider ${style.cls}`}
                    >
                      <PillIcon className="h-2.5 w-2.5" />
                      {style.text}
                    </span>
                  </div>
                  {detail && (
                    <div className="mt-0.5 truncate font-mono text-[10px] text-slate-500">
                      {detail}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {notes.length > 0 && (
        <ul className="mt-3 space-y-1">
          {notes.map((n, i) => (
            <li key={i} className="text-[11px] leading-relaxed text-slate-500">
              {n}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
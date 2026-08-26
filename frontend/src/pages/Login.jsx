import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Shield, Eye, EyeOff, ArrowRight, Loader2, Lock, Mail } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { formatApiError } from "@/lib/api";

export default function Login() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("ScamSense@admin.com");
  const [password, setPassword] = useState("SS012");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (user && user !== false) return <Navigate to="/" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      nav("/", { replace: true });
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#fafbff] flex items-center justify-center px-4 py-12 relative overflow-hidden">
      {/* Vibrant animated gradient orbs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-32 -left-32 w-[500px] h-[500px] rounded-full bg-violet-500/20 blur-[100px] animate-pulse-slow" />
        <div className="absolute -bottom-32 -right-32 w-[450px] h-[450px] rounded-full bg-coral-500/15 blur-[100px] animate-pulse-slow" style={{ animationDelay: "1.5s" }} />
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[350px] h-[350px] rounded-full bg-sky-400/10 blur-[80px] animate-pulse-slow" style={{ animationDelay: "3s" }} />
        <div className="absolute bottom-1/4 left-1/4 w-[300px] h-[300px] rounded-full bg-amber-400/10 blur-[80px] animate-pulse-slow" style={{ animationDelay: "2s" }} />
      </div>

      {/* Subtle dot grid */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none"
        style={{ backgroundImage: 'radial-gradient(circle, #6c3ff5 1px, transparent 1px)', backgroundSize: '24px 24px' }}
      />

      <div className="relative z-10 w-full max-w-md">
        <div className="flex items-center gap-3 mb-8 animate-fade-in">
          <div className="h-12 w-12 rounded-2xl gradient-brand flex items-center justify-center shadow-glow-brand">
            <Shield className="h-6 w-6 text-white" strokeWidth={2.5} />
          </div>
          <div>
            <div className="text-2xl font-extrabold tracking-tight text-gray-900">ScamSense</div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-gradient">Scam Detection</div>
          </div>
        </div>

        <div className="bg-white rounded-3xl p-8 shadow-card border border-gray-100/80 animate-fade-in" style={{ animationDelay: "0.1s" }}>
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">Welcome back</h1>
          <p className="text-sm text-gray-500 mt-1.5">Sign in to access the threat console.</p>

          <form onSubmit={submit} className="mt-8 space-y-5">
            <div>
              <label className="text-xs font-bold text-gray-600 uppercase tracking-wider">Email</label>
              <div className="mt-2 relative group">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 group-focus-within:text-violet-500 transition-colors" />
                <input
                  data-testid="login-email-input"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-gray-50/80 border border-gray-200 rounded-xl pl-10 pr-4 py-3 text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 transition-all"
                  placeholder="you@company.com"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-gray-600 uppercase tracking-wider">Password</label>
              <div className="mt-2 relative group">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 group-focus-within:text-violet-500 transition-colors" />
                <input
                  data-testid="login-password-input"
                  type={showPw ? "text" : "password"}
                  required
                  minLength={1}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-gray-50/80 border border-gray-200 rounded-xl pl-10 pr-12 py-3 text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 transition-all"
                  placeholder="Enter your password"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-violet-500 p-1 transition-colors"
                  aria-label="Toggle password"
                >
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div data-testid="login-error" className="rounded-xl border border-rose-200 bg-rose-50 text-rose-600 text-sm px-4 py-3 font-medium">
                {error}
              </div>
            )}

            <button
              data-testid="login-submit-button"
              type="submit"
              disabled={loading}
              className="w-full gradient-brand text-white font-bold rounded-xl px-4 py-3.5 hover:shadow-glow-brand disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 transition-all duration-300 text-sm"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>

          <div className="mt-6 text-sm text-gray-500 text-center">
            New here?{" "}
            <Link data-testid="link-to-signup" to="/signup" className="text-violet-600 hover:text-violet-700 font-bold transition-colors">
              Create an account
            </Link>
          </div>

          <div className="mt-5 pt-5 border-t border-gray-100 text-center">
            <div className="text-[11px] text-gray-400">
              Demo account prefilled — click <span className="text-gray-600 font-bold">Sign in</span> to explore
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

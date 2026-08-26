import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Shield, Loader2, User, Mail, Lock } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { formatApiError } from "@/lib/api";

export default function Signup() {
  const { user, register } = useAuth();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (user && user !== false) return <Navigate to="/" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await register(email, password, name || undefined);
      nav("/", { replace: true });
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#fafbff] flex items-center justify-center px-4 py-12 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-32 -right-32 w-[500px] h-[500px] rounded-full bg-coral-500/15 blur-[100px] animate-pulse-slow" />
        <div className="absolute -bottom-32 -left-32 w-[450px] h-[450px] rounded-full bg-violet-500/20 blur-[100px] animate-pulse-slow" style={{ animationDelay: "1.5s" }} />
        <div className="absolute top-1/2 right-1/4 w-[300px] h-[300px] rounded-full bg-amber-400/10 blur-[80px] animate-pulse-slow" style={{ animationDelay: "2.5s" }} />
      </div>

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
            <div className="text-[11px] font-bold uppercase tracking-widest text-gradient">Create your account</div>
          </div>
        </div>

        <div className="bg-white rounded-3xl p-8 shadow-card border border-gray-100/80 animate-fade-in" style={{ animationDelay: "0.1s" }}>
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">Create account</h1>
          <p className="text-sm text-gray-500 mt-1.5">Start scanning suspicious URLs and messages.</p>

          <form onSubmit={submit} className="mt-8 space-y-5">
            <div>
              <label className="text-xs font-bold text-gray-600 uppercase tracking-wider">Name</label>
              <div className="mt-2 relative group">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 group-focus-within:text-coral-500 transition-colors" />
                <input
                  data-testid="signup-name-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-gray-50/80 border border-gray-200 rounded-xl pl-10 pr-4 py-3 text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-coral-500/20 focus:border-coral-400 transition-all"
                  placeholder="Optional"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-bold text-gray-600 uppercase tracking-wider">Email</label>
              <div className="mt-2 relative group">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 group-focus-within:text-coral-500 transition-colors" />
                <input
                  data-testid="signup-email-input"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-gray-50/80 border border-gray-200 rounded-xl pl-10 pr-4 py-3 text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-coral-500/20 focus:border-coral-400 transition-all"
                  placeholder="you@company.com"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-bold text-gray-600 uppercase tracking-wider">Password</label>
              <div className="mt-2 relative group">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 group-focus-within:text-coral-500 transition-colors" />
                <input
                  data-testid="signup-password-input"
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-gray-50/80 border border-gray-200 rounded-xl pl-10 pr-4 py-3 text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-coral-500/20 focus:border-coral-400 transition-all"
                  placeholder="At least 6 characters"
                />
              </div>
            </div>

            {error && (
              <div data-testid="signup-error" className="rounded-xl border border-rose-200 bg-rose-50 text-rose-600 text-sm px-4 py-3 font-medium">
                {error}
              </div>
            )}

            <button
              data-testid="signup-submit-button"
              type="submit"
              disabled={loading}
              className="w-full gradient-sunset text-white font-bold rounded-xl px-4 py-3.5 hover:shadow-glow-coral disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 transition-all duration-300 text-sm"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {loading ? "Creating..." : "Create account"}
            </button>
          </form>

          <div className="mt-6 text-sm text-gray-500 text-center">
            Already have an account?{" "}
            <Link data-testid="link-to-login" to="/login" className="text-coral-500 hover:text-coral-600 font-bold transition-colors">
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

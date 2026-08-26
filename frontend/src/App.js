import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Shield } from "lucide-react";
import { AuthProvider, useAuth } from "./context/AuthContext";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Dashboard from "./pages/Dashboard";

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (user === false) return <Navigate to="/login" replace />;
  return children;
}

function Public({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (user) return <Navigate to="/" replace />;
  return children;
}

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-[#fafbff] flex items-center justify-center">
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-32 -left-32 w-[400px] h-[400px] rounded-full bg-violet-500/15 blur-[100px] animate-pulse-slow" />
        <div className="absolute -bottom-32 -right-32 w-[400px] h-[400px] rounded-full bg-coral-500/10 blur-[100px] animate-pulse-slow" style={{ animationDelay: "1.5s" }} />
      </div>
      <div className="relative z-10 flex flex-col items-center gap-4">
        <div className="relative">
          <div className="h-16 w-16 rounded-full border-2 border-violet-100" />
          <div className="absolute inset-0 rounded-full border-t-2 border-violet-500 animate-spin" />
          <div className="absolute inset-2 rounded-full border-t-2 border-coral-400 animate-spin" style={{ animationDirection: "reverse", animationDuration: "1.5s" }} />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-10 w-10 rounded-2xl gradient-brand flex items-center justify-center shadow-glow-brand">
              <Shield className="h-5 w-5 text-white" strokeWidth={2.5} />
            </div>
          </div>
        </div>
        <div className="text-sm font-bold text-gradient animate-pulse">Loading ScamSense...</div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Public><Login /></Public>} />
          <Route path="/signup" element={<Public><Signup /></Public>} />
          <Route path="/" element={<Protected><Dashboard /></Protected>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

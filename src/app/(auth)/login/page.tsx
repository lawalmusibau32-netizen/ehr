"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  LogIn,
  Eye,
  EyeOff,
  User,
  Lock,
  AlertCircle,
  ShieldCheck,
  Mail,
  KeyRound,
  Copy,
  Check,
} from "lucide-react";

type PendingState = {
  mfaToken: string;
  expiresIn: number;
  enroll?: boolean;
};

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [focusedField, setFocusedField] = useState<"username" | "password" | null>(null);
  const usernameRef = useRef<HTMLInputElement>(null);

  const [pending, setPending] = useState<PendingState | null>(null);
  const [code, setCode] = useState("");
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [codesCopied, setCodesCopied] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (pending) {
      const timer = setTimeout(() => codeRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    }
  }, [pending]);

  const countingDown = countdown > 0;

  useEffect(() => {
    if (!countingDown) return;
    const t = setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [countingDown]);

  async function handleLoginSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const form = new FormData(e.currentTarget);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: form.get("username"),
        password: form.get("password"),
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Login failed.");
      setLoading(false);
      return;
    }

    if (data.mfaRequired || data.mfaEnrollRequired) {
      setPending({
        mfaToken: data.mfaToken,
        expiresIn: data.expiresIn ?? 600,
        enroll: !!data.mfaEnrollRequired,
      });
      setCountdown(data.expiresIn ?? 600);
      setLoading(false);
      return;
    }

    const redirect = searchParams.get("redirect") ?? "/dashboard";
    router.push(redirect);
    router.refresh();
  }

  async function handleCodeSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!pending) return;
    setError("");
    setLoading(true);

    const endpoint = pending.enroll ? "/api/auth/mfa/enroll-verify" : "/api/auth/mfa/challenge";
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        recoveryMode
          ? { mfaToken: pending.mfaToken, recoveryCode: code.trim().toUpperCase() }
          : { mfaToken: pending.mfaToken, code: code.trim() }
      ),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Verification failed.");
      setCode("");
      setLoading(false);
      return;
    }

    if (pending.enroll && data.recoveryCodes) {
      setRecoveryCodes(data.recoveryCodes);
      setLoading(false);
      return;
    }

    const redirect = searchParams.get("redirect") ?? "/dashboard";
    router.push(redirect);
    router.refresh();
  }

  async function handleResend() {
    if (!pending) return;
    setError("");
    const res = await fetch("/api/auth/mfa/resend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mfaToken: pending.mfaToken }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Could not resend code.");
      return;
    }
    setCountdown(data.expiresIn ?? 600);
  }

  function copyRecoveryCodes() {
    if (!recoveryCodes) return;
    navigator.clipboard.writeText(recoveryCodes.join("\n"));
    setCodesCopied(true);
    setTimeout(() => setCodesCopied(false), 2000);
  }

  function formatTime(s: number) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }

  if (recoveryCodes) {
    return (
      <div className="space-y-6">
        <div className="text-center space-y-1">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/20">
            <KeyRound className="h-5 w-5 text-emerald-400" />
          </div>
          <h2 className="text-xl font-semibold tracking-tight">Save Your Recovery Codes</h2>
          <p className="text-sm text-muted-foreground/50">
            Each code works once. Store them somewhere safe — they are your only backup if you lose email access.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          {recoveryCodes.map((rc) => (
            <div key={rc} className="rounded-lg border border-muted/40 bg-muted/20 px-3 py-2.5 font-mono text-xs tracking-wider text-center">
              {rc}
            </div>
          ))}
        </div>

        <div className="flex gap-3">
          <Button
            type="button"
            variant="outline"
            className="flex-1 h-11 rounded-xl"
            onClick={copyRecoveryCodes}
          >
            {codesCopied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
            <span>{codesCopied ? "Copied" : "Copy codes"}</span>
          </Button>
          <Button
            type="button"
            className="flex-1 h-11 rounded-xl"
            onClick={() => {
              const redirect = searchParams.get("redirect") ?? "/dashboard";
              router.push(redirect);
              router.refresh();
            }}
          >
            <LogIn className="h-4 w-4" />
            <span>Continue to dashboard</span>
          </Button>
        </div>
      </div>
    );
  }

  if (pending) {
    return (
      <div className="space-y-6">
        <div className="text-center space-y-1">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 border border-primary/20">
            <ShieldCheck className="h-5 w-5 text-primary" />
          </div>
          <h2 className="text-xl font-semibold tracking-tight">
            {pending.enroll ? "Enable Two-Factor Verification" : "Enter Verification Code"}
          </h2>
          <p className="text-sm text-muted-foreground/50 flex items-center justify-center gap-1.5">
            <Mail className="h-3.5 w-3.5" />
            We sent a 6-digit code to your email
          </p>
        </div>

        <form onSubmit={handleCodeSubmit} className="space-y-5" noValidate>
          {error && (
            <div className="flex items-start gap-2.5 rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive animate-slide-up">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="code" className="text-xs font-medium text-muted-foreground/60 tracking-wide uppercase">
              {recoveryMode ? "Recovery code" : "Verification code"}
            </Label>
            <div className="relative">
              <div className="relative flex items-center">
                <KeyRound className={`absolute left-3.5 h-4 w-4 transition-all duration-300 ${code ? "text-primary" : "text-muted-foreground/30"}`} />
                <Input
                  id="code"
                  ref={codeRef}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/[^0-9A-Za-z]/g, "").slice(0, recoveryMode ? 10 : 6))}
                  className="glass-input pl-10 pr-10 h-11 rounded-xl text-sm tracking-[0.3em] font-mono placeholder:tracking-normal"
                  placeholder={recoveryMode ? "XXXXX-XXXXX" : "••••••"}
                  inputMode={recoveryMode ? "text" : "numeric"}
                  maxLength={recoveryMode ? 10 : 6}
                  autoComplete="one-time-code"
                  required
                />
              </div>
            </div>
          </div>

          <Button
            type="submit"
            className="relative w-full h-11 rounded-xl overflow-hidden group"
            disabled={loading || code.length < (recoveryMode ? 10 : 6)}
          >
            <div className="absolute inset-0 bg-gradient-to-r from-primary via-cyan-500 to-primary bg-[length:200%_100%] animate-shimmer opacity-90 group-hover:opacity-100 transition-opacity" />
            <span className="relative flex items-center justify-center gap-2 font-medium">
              {loading ? (
                <>
                  <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  <span>Verifying</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="h-4 w-4" />
                  <span>{pending.enroll ? "Verify & Enable" : "Verify"}</span>
                </>
              )}
            </span>
          </Button>

          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground/40">
              {countdown > 0 ? (
                <>
                  Code expires in <span className="font-mono text-primary/70">{formatTime(countdown)}</span>
                </>
              ) : (
                <button type="button" onClick={handleResend} className="text-primary/80 hover:text-primary transition-colors">
                  Code expired — resend
                </button>
              )}
            </span>
            {countdown === 0 && (
              <button type="button" onClick={handleResend} className="text-primary/80 hover:text-primary transition-colors">
                Resend code
              </button>
            )}
          </div>

          {!pending.enroll && (
            <button
              type="button"
              onClick={() => {
                setRecoveryMode(!recoveryMode);
                setCode("");
                setError("");
              }}
              className="w-full text-center text-[11px] text-muted-foreground/50 hover:text-muted-foreground/80 transition-colors"
            >
              {recoveryMode ? "Back to verification code" : "Can't access your email? Use a recovery code"}
            </button>
          )}
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">Welcome Back</h2>
        <p className="text-sm text-muted-foreground/50">Sign in to access your dashboard</p>
      </div>

      <form onSubmit={handleLoginSubmit} className="space-y-5" noValidate>
        {error && (
          <div className="flex items-start gap-2.5 rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive shadow-[0_0_20px_rgba(239,68,68,0.06)] animate-slide-up">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="username" className="text-xs font-medium text-muted-foreground/60 tracking-wide uppercase">Username</Label>
          <div className="relative">
            <div className={`absolute inset-0 rounded-xl bg-gradient-to-r from-primary/20 via-cyan-500/10 to-transparent opacity-0 transition-opacity duration-500 ${focusedField === "username" ? "opacity-100" : ""}`} />
            <div className="relative flex items-center">
              <User className={`absolute left-3.5 h-4 w-4 transition-all duration-300 ${focusedField === "username" ? "text-primary" : "text-muted-foreground/30"}`} />
              <Input
                id="username"
                name="username"
                ref={usernameRef}
                required
                autoFocus={false}
                onFocus={() => setFocusedField("username")}
                onBlur={() => setFocusedField(null)}
                className="glass-input pl-10 h-11 rounded-xl text-sm placeholder:text-muted-foreground/25"
                placeholder="Enter your username"
              />
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password" className="text-xs font-medium text-muted-foreground/60 tracking-wide uppercase">Password</Label>
            <span className="text-[11px] text-muted-foreground/30 hover:text-primary/60 cursor-default transition-colors duration-300">Forgot password?</span>
          </div>
          <div className="relative">
            <div className={`absolute inset-0 rounded-xl bg-gradient-to-r from-primary/20 via-cyan-500/10 to-transparent opacity-0 transition-opacity duration-500 ${focusedField === "password" ? "opacity-100" : ""}`} />
            <div className="relative flex items-center">
              <Lock className={`absolute left-3.5 h-4 w-4 transition-all duration-300 ${focusedField === "password" ? "text-primary" : "text-muted-foreground/30"}`} />
              <Input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                required
                onFocus={() => setFocusedField("password")}
                onBlur={() => setFocusedField(null)}
                className="glass-input pl-10 pr-10 h-11 rounded-xl text-sm placeholder:text-muted-foreground/25"
                placeholder="Enter your password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className={`absolute right-3.5 transition-all duration-300 ${focusedField === "password" ? "text-primary/70" : "text-muted-foreground/30"} hover:text-muted-foreground/60`}
                tabIndex={-1}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>

        <Button
          type="submit"
          className="relative w-full h-11 rounded-xl overflow-hidden group"
          disabled={loading}
        >
          <div className="absolute inset-0 bg-gradient-to-r from-primary via-cyan-500 to-primary bg-[length:200%_100%] animate-shimmer opacity-90 group-hover:opacity-100 transition-opacity" />
          <span className="relative flex items-center justify-center gap-2 font-medium">
            {loading ? (
              <>
                <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                <span>Signing in</span>
              </>
            ) : (
              <>
                <LogIn className="h-4 w-4" />
                <span>Sign In</span>
              </>
            )}
          </span>
        </Button>

        <p className="text-center text-[11px] text-muted-foreground/25 tracking-wider uppercase select-none">
          Electronic Health Record System v2.0
        </p>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-12">
        <span className="h-5 w-5 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
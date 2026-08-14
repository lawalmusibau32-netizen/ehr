"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ShieldCheck,
  ShieldOff,
  Mail,
  AlertCircle,
  Check,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  mfaEnabled: string;
  email: string | null;
}

export default function AccountSecurity({ mfaEnabled, email }: Props) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [showDisable, setShowDisable] = useState(false);
  const [sentCode, setSentCode] = useState(false);

  async function sendDisableCode() {
    if (!password) {
      setError("Enter your password first.");
      return;
    }
    setError("");
    setLoading(true);
    const res = await fetch("/api/auth/mfa/send-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setLoading(false);
    if (!res) {
      setError("Could not send code.");
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setSentCode(true);
      setSuccess("Verification code sent to your email.");
    } else {
      setError(data.error ?? "Could not send code. Check your password.");
    }
  }

  async function disableMfa() {
    setError("");
    setLoading(true);
    const res = await fetch("/api/auth/mfa/disable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, code }),
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "Failed to disable MFA.");
      return;
    }
    setSuccess("MFA disabled.");
    setShowDisable(false);
    setSentCode(false);
    setPassword("");
    setCode("");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-start gap-2.5 rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive animate-slide-up">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="flex items-start gap-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3 text-sm text-emerald-500 animate-slide-up">
          <Check className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      <div className="rounded-xl border border-border/30 bg-card/50 backdrop-blur-sm p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${mfaEnabled === "Y" ? "bg-emerald-500/10 border border-emerald-500/20" : "bg-amber-500/10 border border-amber-500/20"}`}>
              {mfaEnabled === "Y" ? <ShieldCheck className="h-5 w-5 text-emerald-400" /> : <ShieldOff className="h-5 w-5 text-amber-400" />}
            </div>
            <div>
              <h3 className="font-medium text-foreground/90">Two-Factor Authentication</h3>
              <p className="text-sm text-muted-foreground/60 mt-1">
                {mfaEnabled === "Y"
                  ? "Your account is protected. A verification code is sent to your email on every login."
                  : "Your account is not protected. MFA is required by policy — you will be asked to enable it at next login."}
              </p>
              <div className="flex items-center gap-1.5 mt-3 text-xs text-muted-foreground/50">
                <Mail className="h-3.5 w-3.5" />
                Codes are sent to: <span className="text-foreground/70 font-medium">{email ?? "No email on file"}</span>
              </div>
            </div>
          </div>
          <span className={`px-2.5 py-1 rounded-full text-[10px] font-medium tracking-wide ${mfaEnabled === "Y" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-amber-500/10 text-amber-400 border border-amber-500/20"}`}>
            {mfaEnabled === "Y" ? "ENABLED" : "DISABLED"}
          </span>
        </div>
      </div>

      {mfaEnabled === "Y" && !showDisable && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowDisable(true)}
          className="text-destructive hover:text-destructive hover:bg-destructive/10 rounded-lg"
        >
          <ShieldOff className="h-4 w-4" />
          Disable Two-Factor Authentication
        </Button>
      )}

      {showDisable && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/[0.03] backdrop-blur-sm p-6 space-y-4">
          <h3 className="font-medium text-foreground/90 text-sm">Disable MFA — confirmation required</h3>
          <p className="text-xs text-muted-foreground/60">
            Enter your password{!sentCode ? " — we will send a code to your email" : " and the verification code we sent"} to confirm.
          </p>

          <div className="space-y-2 max-w-xs">
            <Label htmlFor="mfa-password" className="text-xs text-muted-foreground/70 font-medium">Password</Label>
            <Input
              id="mfa-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="glass-input h-10 rounded-lg text-sm"
              placeholder="Your password"
            />
          </div>

          {sentCode ? (
            <div className="space-y-2 max-w-xs">
              <Label htmlFor="mfa-code" className="text-xs text-muted-foreground/70 font-medium">Verification code</Label>
              <Input
                id="mfa-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                className="glass-input h-10 rounded-lg text-sm font-mono tracking-[0.3em]"
                placeholder="••••••"
                inputMode="numeric"
                maxLength={6}
              />
            </div>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={sendDisableCode} disabled={loading} className="rounded-lg">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              Send verification code
            </Button>
          )}

          <div className="flex gap-3">
            {sentCode && (
              <Button type="button" size="sm" onClick={disableMfa} disabled={loading || !code || !password} className="rounded-lg bg-destructive hover:bg-destructive/90">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldOff className="h-4 w-4" />}
                Confirm disable
              </Button>
            )}
            <Button type="button" variant="ghost" size="sm" onClick={() => { setShowDisable(false); setSentCode(false); setPassword(""); setCode(""); setError(""); }} className="rounded-lg">
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
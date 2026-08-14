"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import Link from "next/link";
import { UserPlus, ArrowLeft } from "lucide-react";

const ROLES = [
  { value: "administrator", label: "Administrator" },
  { value: "doctor", label: "Doctor" },
  { value: "nurse", label: "Nurse" },
  { value: "receptionist", label: "Receptionist" },
];

export default function RegisterPage() {
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      const form = new FormData(e.currentTarget);
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: form.get("username"),
          displayName: form.get("displayName"),
          email: form.get("email"),
          roleName: form.get("roleName"),
          password: form.get("password"),
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data?.error ?? `Registration failed (${res.status}).`);
        setLoading(false);
        return;
      }

      setSuccess("User registered successfully.");
    } catch {
      setError("A network error occurred. Please try again.");
    }
    setLoading(false);
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-xl font-semibold text-foreground/90">Register User</h2>
        <p className="text-sm text-muted-foreground/60 mt-1">Create a new system account</p>
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {error && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive shadow-[0_0_20px_rgba(239,68,68,0.06)]">
            {error}
          </div>
        )}
        {success && (
          <div className="space-y-3">
            <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3 text-sm text-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.06)]">
              {success}
            </div>
            <Link href="/users" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/60 hover:text-foreground/80 transition-colors">
              <ArrowLeft className="h-3 w-3" />
              Back to User Management
            </Link>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="username" className="text-xs text-muted-foreground/70 font-medium">Username</Label>
          <Input id="username" name="username" required />
        </div>

        <div className="space-y-2">
          <Label htmlFor="displayName" className="text-xs text-muted-foreground/70 font-medium">Display Name</Label>
          <Input id="displayName" name="displayName" required />
        </div>

        <div className="space-y-2">
          <Label htmlFor="email" className="text-xs text-muted-foreground/70 font-medium">Email <span className="text-destructive">*</span></Label>
          <Input id="email" name="email" type="email" required />
          <p className="text-[10px] text-muted-foreground/50 mt-1">Required — MFA verification codes are sent to this address.</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="roleName" className="text-xs text-muted-foreground/70 font-medium">Role</Label>
          <Select id="roleName" name="roleName" options={ROLES} placeholder="Select role" required />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password" className="text-xs text-muted-foreground/70 font-medium">Password</Label>
          <Input id="password" name="password" type="password" required minLength={6} />
          <p className="text-[10px] text-muted-foreground/50 mt-1">Min 6 chars with lowercase and digit.</p>
        </div>

        <Button type="submit" className="w-full h-10 rounded-xl" disabled={loading}>
          {loading ? (
            <span className="flex items-center gap-2">
              <span className="h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              Registering...
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <UserPlus className="h-4 w-4" />
              Register User
            </span>
          )}
        </Button>
      </form>
    </div>
  );
}

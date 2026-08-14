"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LogOut, User, Shield, ChevronDown, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TopbarProps {
  userName: string;
  roleName: string;
}

export function Topbar({ userName, roleName }: TopbarProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="h-14 glass-topbar flex items-center px-6 gap-4 shrink-0">
      <div className="flex-1">
        <div className="text-xs text-muted-foreground/60 tracking-wide">Healthcare Information System</div>
      </div>

      <div className="flex items-center gap-4">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-medium tracking-wide shadow-[0_0_10px_rgba(16,185,129,0.06)]">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
          </span>
          LIVE
        </span>

        <div className="relative">
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "gap-2 rounded-lg border border-border/20 bg-white/[0.03] backdrop-blur-sm hover:bg-white/[0.06] hover:border-border/40 transition-all duration-300",
              open && "bg-white/[0.06] border-border/40"
            )}
            onClick={() => setOpen(!open)}
          >
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center">
              <User className="h-3 w-3 text-primary/80" />
            </div>
            <span className="text-sm text-foreground/80">{userName}</span>
            <ChevronDown className={cn("h-3 w-3 text-muted-foreground/60 transition-transform duration-300", open && "rotate-180")} />
          </Button>

          {open && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
              <div className="absolute right-0 top-full mt-2 w-56 rounded-xl border border-border/30 bg-card/80 backdrop-blur-2xl p-2 shadow-2xl z-20 animate-fade-in">
                <div className="px-3 py-2.5 text-sm text-muted-foreground/70 border-b border-border/20 mb-1">
                  <div className="font-medium text-foreground/90">{userName}</div>
                  <div className="flex items-center gap-1.5 text-xs mt-1">
                    <Shield className="h-3 w-3 text-primary/60" />
                    <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary/80 text-[10px] font-medium">
                      {roleName}
                    </span>
                  </div>
                </div>

                <Link
                  href="/account/security"
                  className="flex items-center gap-2.5 px-3 py-2 text-sm text-muted-foreground/70 hover:text-foreground hover:bg-white/[0.06] rounded-lg transition-all duration-300"
                  onClick={() => setOpen(false)}
                >
                  <Settings className="h-4 w-4" />
                  Account Security
                </Link>

                <form action={handleLogout}>
                  <Button
                    type="submit"
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start gap-2.5 text-muted-foreground/70 hover:text-destructive hover:bg-destructive/10 rounded-lg transition-all duration-300"
                  >
                    <LogOut className="h-4 w-4" />
                    Sign Out
                  </Button>
                </form>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import AccountSecurity from "./security-form";

export default async function AccountSecurityPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const dbUser = await prisma.user.findUnique({
    where: { userId: user.sub },
    select: { mfaEnabled: true, email: true },
  });

  return (
    <div className="max-w-3xl mx-auto py-8 px-6">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground/90">Account Security</h1>
        <p className="text-sm text-muted-foreground/60 mt-1">Manage your two-factor authentication settings</p>
      </div>
      <AccountSecurity
        mfaEnabled={dbUser?.mfaEnabled ?? "N"}
        email={dbUser?.email ?? null}
      />
    </div>
  );
}
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyAccessToken, AUTH_COOKIE_NAME } from "@/lib/auth";
import { normalizeRoleKey } from "@/lib/roles";
import { isRateLimited } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    const rate = isRateLimited(request, 10, 60 * 1000);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please wait before trying again." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfter) } }
      );
    }

    const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
    const authUser = token ? verifyAccessToken(token) : null;
    if (!authUser || normalizeRoleKey(authUser.role) !== "administrator") {
      return NextResponse.json({ error: "Administrator access required." }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const { userId } = body as { userId?: number };
    if (!userId) return NextResponse.json({ error: "User ID required." }, { status: 400 });

    const user = await prisma.user.findUnique({ where: { userId } });
    if (!user) return NextResponse.json({ error: "User not found." }, { status: 404 });

    await prisma.user.update({
      where: { userId },
      data: {
        mfaEnabled: "N",
        mfaSecret: null,
        mfaRecoveryCodes: null,
        otpHash: null,
        otpExpiresAt: null,
        otpAttempts: 0,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: authUser.sub,
        actionType: "MFA_RESET",
        entityName: "users",
        entityId: String(userId),
        details: `MFA reset for user ${user.username} by administrator.`,
        ipAddress: request.headers.get("x-forwarded-for") ?? "unknown",
      },
    });

    return NextResponse.json({ message: `MFA reset for ${user.username}. They will re-enroll at next login.` });
  } catch {
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}
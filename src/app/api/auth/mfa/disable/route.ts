import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { verifyAccessToken, AUTH_COOKIE_NAME } from "@/lib/auth";
import { hashOtp, consumeRecoveryCode } from "@/lib/mfa";
import { isRateLimited } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    const rate = isRateLimited(request, 10, 60 * 1000);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Too many attempts. Please wait before trying again." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfter) } }
      );
    }

    const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
    const authUser = token ? verifyAccessToken(token) : null;
    if (!authUser) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const { password, code, recoveryCode } = body as { password?: string; code?: string; recoveryCode?: string };

    const user = await prisma.user.findUnique({ where: { userId: authUser.sub } });
    if (!user) return NextResponse.json({ error: "User not found." }, { status: 404 });
    if (user.mfaEnabled !== "Y") {
      return NextResponse.json({ error: "MFA is not enabled for this account." }, { status: 400 });
    }

    if (!password || !bcrypt.compareSync(password, user.passwordHash)) {
      return NextResponse.json({ error: "Invalid password." }, { status: 401 });
    }

    let mfaValid = false;
    if (recoveryCode) {
      mfaValid = await consumeRecoveryCode(user.userId, recoveryCode);
    } else if (code && user.otpHash && user.otpExpiresAt && user.otpExpiresAt > new Date()) {
      mfaValid = hashOtp(code.trim()) === user.otpHash;
    }

    if (!mfaValid) {
      return NextResponse.json({ error: "Invalid verification code." }, { status: 401 });
    }

    await prisma.user.update({
      where: { userId: user.userId },
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
        userId: user.userId,
        actionType: "MFA_DISABLED",
        entityName: "users",
        entityId: String(user.userId),
        details: "MFA disabled by account owner.",
        ipAddress: request.headers.get("x-forwarded-for") ?? "unknown",
      },
    });

    return NextResponse.json({ message: "MFA disabled." });
  } catch {
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}
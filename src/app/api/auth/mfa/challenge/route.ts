import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  hashOtp,
  verifyPendingToken,
  consumeRecoveryCode,
  isOtpLocked,
} from "@/lib/mfa";
import { issueSessionResponse } from "@/lib/session";
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

    const body = await request.json().catch(() => ({}));
    const { mfaToken, code, recoveryCode } = body as { mfaToken?: string; code?: string; recoveryCode?: string };

    const userId = mfaToken ? verifyPendingToken(mfaToken, "challenge") : null;
    if (!userId) return NextResponse.json({ error: "Session expired. Please log in again." }, { status: 401 });

    const user = await prisma.user.findUnique({
      where: { userId },
      include: { role: true },
    });
    if (!user) return NextResponse.json({ error: "User not found." }, { status: 404 });
    if (user.mfaEnabled !== "Y") {
      return NextResponse.json({ error: "MFA is not enabled for this account." }, { status: 400 });
    }

    let valid = false;

    if (recoveryCode) {
      valid = await consumeRecoveryCode(userId, recoveryCode);
      if (valid) {
        await prisma.auditLog.create({
          data: {
            userId,
            actionType: "MFA_VERIFIED",
            entityName: "users",
            entityId: String(userId),
            details: "Login verified with recovery code.",
            ipAddress: request.headers.get("x-forwarded-for") ?? "unknown",
          },
        });
      }
    } else {
      if (isOtpLocked(user)) {
        return NextResponse.json({ error: "Too many attempts. Request a new code." }, { status: 429 });
      }
      if (!user.otpHash || !user.otpExpiresAt || user.otpExpiresAt < new Date()) {
        return NextResponse.json({ error: "Code expired. Request a new code." }, { status: 400 });
      }
      valid = hashOtp((code ?? "").trim()) === user.otpHash;
      if (valid) {
        await prisma.user.update({
          where: { userId },
          data: { otpHash: null, otpExpiresAt: null, otpAttempts: 0 },
        });
        await prisma.auditLog.create({
          data: {
            userId,
            actionType: "MFA_VERIFIED",
            entityName: "users",
            entityId: String(userId),
            details: "Login verified with email OTP.",
            ipAddress: request.headers.get("x-forwarded-for") ?? "unknown",
          },
        });
      } else {
        await prisma.user.update({
          where: { userId },
          data: { otpAttempts: { increment: 1 } },
        });
        await prisma.auditLog.create({
          data: {
            userId,
            actionType: "MFA_FAILED",
            entityName: "users",
            entityId: String(userId),
            details: "Invalid MFA code.",
            ipAddress: request.headers.get("x-forwarded-for") ?? "unknown",
          },
        });
      }
    }

    if (!valid) return NextResponse.json({ error: "Invalid code." }, { status: 401 });

    await prisma.user.update({
      where: { userId },
      data: { otpAttempts: 0 },
    });

    return issueSessionResponse(
      {
        userId: user.userId,
        username: user.username,
        roleName: user.role.roleName,
        email: user.email,
      },
      request
    );
  } catch {
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  hashOtp,
  verifyPendingToken,
  generateRecoveryCodes,
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
    const { mfaToken, code } = body as { mfaToken?: string; code?: string };

    const userId = mfaToken ? verifyPendingToken(mfaToken, "enroll") : null;
    if (!userId) return NextResponse.json({ error: "Session expired. Please log in again." }, { status: 401 });

    const user = await prisma.user.findUnique({ where: { userId } });
    if (!user) return NextResponse.json({ error: "User not found." }, { status: 404 });
    if (user.mfaEnabled === "Y") {
      return NextResponse.json({ error: "MFA is already enabled." }, { status: 400 });
    }
    if (isOtpLocked(user)) {
      return NextResponse.json({ error: "Too many attempts. Request a new code." }, { status: 429 });
    }
    if (!user.otpHash || !user.otpExpiresAt || user.otpExpiresAt < new Date()) {
      return NextResponse.json({ error: "Code expired. Request a new code." }, { status: 400 });
    }

    const valid = hashOtp((code ?? "").trim()) === user.otpHash;
    if (!valid) {
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
          details: "Invalid enrollment code.",
          ipAddress: request.headers.get("x-forwarded-for") ?? "unknown",
        },
      });
      return NextResponse.json(
        { error: "Invalid code." },
        { status: 401 }
      );
    }

    const recoveryCodes = generateRecoveryCodes();
    await prisma.$transaction([
      prisma.user.update({
        where: { userId },
        data: {
          mfaEnabled: "Y",
          otpHash: null,
          otpExpiresAt: null,
          otpAttempts: 0,
        },
      }),
      prisma.user.update({
        where: { userId },
        data: { mfaRecoveryCodes: JSON.stringify(recoveryCodes.map((c) => hashOtp(c))) },
      }),
    ]);

    await prisma.auditLog.create({
      data: {
        userId,
        actionType: "MFA_ENROLLED",
        entityName: "users",
        entityId: String(userId),
        details: "MFA enabled via email OTP.",
        ipAddress: request.headers.get("x-forwarded-for") ?? "unknown",
      },
    });

    return issueSessionResponse(user, request, { recoveryCodes });
  } catch {
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}
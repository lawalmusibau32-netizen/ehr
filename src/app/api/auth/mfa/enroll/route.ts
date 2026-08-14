import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  generateOtp,
  hashOtp,
  sendOtpEmail,
  createPendingToken,
  OTP_TTL_MS_VALUE,
} from "@/lib/mfa";
import { isRateLimited } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    const rate = isRateLimited(request, 5, 60 * 1000);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please wait before trying again." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfter) } }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { userId } = body as { userId?: number };
    if (!userId) return NextResponse.json({ error: "User ID required." }, { status: 400 });

    const user = await prisma.user.findUnique({ where: { userId } });
    if (!user) return NextResponse.json({ error: "User not found." }, { status: 404 });
    if (user.mfaEnabled === "Y") {
      return NextResponse.json({ error: "MFA is already enabled." }, { status: 400 });
    }
    if (!user.email) {
      return NextResponse.json({ error: "No email on file. Contact your administrator." }, { status: 400 });
    }

    const code = generateOtp();
    await prisma.user.update({
      where: { userId },
      data: {
        otpHash: hashOtp(code),
        otpExpiresAt: new Date(Date.now() + OTP_TTL_MS_VALUE),
        otpAttempts: 0,
      },
    });

    try {
      await sendOtpEmail(user.email, code);
    } catch {
      console.log(`[MFA enrollment OTP for ${user.username}]: ${code}`);
    }

    await prisma.auditLog.create({
      data: {
        userId: user.userId,
        actionType: "MFA_OTP_SENT",
        entityName: "users",
        entityId: String(user.userId),
        details: "MFA enrollment code sent.",
        ipAddress: request.headers.get("x-forwarded-for") ?? "unknown",
      },
    });

    return NextResponse.json({ mfaToken: createPendingToken(user.userId, "enroll"), expiresIn: OTP_TTL_MS_VALUE / 1000 });
  } catch {
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}
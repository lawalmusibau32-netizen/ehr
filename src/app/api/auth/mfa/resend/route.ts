import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  generateOtp,
  hashOtp,
  sendOtpEmail,
  verifyPendingToken,
  OTP_TTL_MS_VALUE,
} from "@/lib/mfa";
import { isRateLimited } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    const rate = isRateLimited(request, 1, 60 * 1000);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Please wait a minute before requesting a new code." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfter) } }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { mfaToken } = body as { mfaToken?: string };

    const userId = mfaToken ? verifyPendingToken(mfaToken, "challenge") || verifyPendingToken(mfaToken, "enroll") : null;
    if (!userId) return NextResponse.json({ error: "Session expired. Please log in again." }, { status: 401 });

    const user = await prisma.user.findUnique({ where: { userId } });
    if (!user) return NextResponse.json({ error: "User not found." }, { status: 404 });
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
      console.log(`[MFA OTP for ${user.username}]: ${code}`);
    }

    return NextResponse.json({ expiresIn: OTP_TTL_MS_VALUE / 1000 });
  } catch {
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}
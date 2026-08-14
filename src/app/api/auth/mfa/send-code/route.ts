import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { verifyAccessToken, AUTH_COOKIE_NAME } from "@/lib/auth";
import {
  generateOtp,
  hashOtp,
  sendOtpEmail,
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

    const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
    const authUser = token ? verifyAccessToken(token) : null;
    if (!authUser) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const { password } = body as { password?: string };

    const user = await prisma.user.findUnique({ where: { userId: authUser.sub } });
    if (!user) return NextResponse.json({ error: "User not found." }, { status: 404 });
    if (user.mfaEnabled !== "Y") {
      return NextResponse.json({ error: "MFA is not enabled for this account." }, { status: 400 });
    }

    if (!password || !bcrypt.compareSync(password, user.passwordHash)) {
      return NextResponse.json({ error: "Invalid password." }, { status: 401 });
    }

    if (!user.email) {
      return NextResponse.json({ error: "No email on file. Contact your administrator." }, { status: 400 });
    }

    const code = generateOtp();
    await prisma.user.update({
      where: { userId: user.userId },
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
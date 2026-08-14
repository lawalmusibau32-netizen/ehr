import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { loginSchema } from "@/lib/validations/auth";
import { isRateLimited } from "@/lib/rate-limit";
import {
  generateOtp,
  hashOtp,
  sendOtpEmail,
  createPendingToken,
  OTP_TTL_MS_VALUE,
} from "@/lib/mfa";

export async function POST(request: Request) {
  try {
    const rate = isRateLimited(
      request,
      parseInt(process.env.LOGIN_RATE_LIMIT_ATTEMPTS ?? "10", 10),
      parseInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MS ?? (60 * 1000).toString(), 10)
    );
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Too many login attempts. Please wait before trying again." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfter) } }
      );
    }

    const body = await request.json();
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 });
    }

    const { username, password } = parsed.data;

    const user = await prisma.user.findFirst({
      where: { username: { equals: username } },
      include: { role: true },
    });

    if (!user || user.isActive !== "Y") {
      return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
    }

    if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
      return NextResponse.json({ error: "Account is temporarily locked." }, { status: 401 });
    }

    const valid = bcrypt.compareSync(password, user.passwordHash);
    if (!valid) {
      await prisma.user.update({
        where: { userId: user.userId },
        data: {
          failedLoginCount: { increment: 1 },
          lockedUntil:
            user.failedLoginCount + 1 >= parseInt(process.env.ACCOUNT_LOCKOUT_ATTEMPTS ?? "5", 10)
              ? new Date(Date.now() + parseInt(process.env.ACCOUNT_LOCKOUT_MINUTES ?? "15", 10) * 60 * 1000)
              : undefined,
        },
      });

      await prisma.auditLog.create({
        data: {
          userId: user.userId,
          actionType: "LOGIN_FAILED",
          entityName: "auth",
          entityId: username,
          details: "Invalid password.",
          ipAddress: request.headers.get("x-forwarded-for") ?? "unknown",
        },
      });

      return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
    }

    if (!user.email) {
      return NextResponse.json(
        { error: "No email on file. Contact your administrator before signing in." },
        { status: 403 }
      );
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

    if (user.mfaEnabled === "Y") {
      return NextResponse.json({
        mfaRequired: true,
        mfaToken: createPendingToken(user.userId, "challenge"),
        expiresIn: OTP_TTL_MS_VALUE / 1000,
      });
    }

    await prisma.auditLog.create({
      data: {
        userId: user.userId,
        actionType: "MFA_OTP_SENT",
        entityName: "users",
        entityId: String(user.userId),
        details: "Enrollment code sent at login.",
        ipAddress: request.headers.get("x-forwarded-for") ?? "unknown",
      },
    });

    return NextResponse.json({
      mfaEnrollRequired: true,
      mfaToken: createPendingToken(user.userId, "enroll"),
      expiresIn: OTP_TTL_MS_VALUE / 1000,
    });
  } catch {
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}

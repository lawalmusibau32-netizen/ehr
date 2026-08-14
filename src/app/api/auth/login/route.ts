import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { loginSchema } from "@/lib/validations/auth";
import { normalizeRoleKey } from "@/lib/roles";
import { isRateLimited } from "@/lib/rate-limit";

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

    const jti = crypto.randomBytes(24).toString("base64url");
    const expiresMinutes = parseInt(process.env.JWT_ACCESS_TOKEN_MINUTES ?? "30", 10);
    const expiresAt = new Date(Date.now() + expiresMinutes * 60 * 1000);

    const session = await prisma.authSession.create({
      data: {
        userId: user.userId,
        jti,
        expiresAt,
        ipAddress: request.headers.get("x-forwarded-for") ?? "unknown",
        userAgent: request.headers.get("user-agent") ?? "unknown",
      },
    });

    await prisma.user.update({
      where: { userId: user.userId },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    const secret = process.env.JWT_SECRET_KEY ?? process.env.SECRET_KEY ?? "change-this-in-production";
    const accessToken = jwt.sign(
      {
        sub: user.userId,
        username: user.username,
        role: user.role.roleName,
        roleKey: normalizeRoleKey(user.role.roleName),
        jti,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(expiresAt.getTime() / 1000),
        iss: process.env.JWT_ISSUER ?? "healthiq-ehr",
        aud: process.env.JWT_AUDIENCE ?? "healthiq-users",
      },
      secret,
      { algorithm: "HS256" }
    );

    const response = NextResponse.json({
      accessToken,
      user: {
        userId: user.userId,
        username: user.username,
        displayName: user.displayName,
        email: user.email,
        roleName: user.role.roleName,
        roleKey: normalizeRoleKey(user.role.roleName),
      },
    });

    response.cookies.set(process.env.AUTH_COOKIE_NAME ?? "ehr_access_token", accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: expiresMinutes * 60,
      path: "/",
    });

    await prisma.auditLog.create({
      data: {
        userId: user.userId,
        actionType: "LOGIN",
        entityName: "auth_sessions",
        entityId: String(session.sessionId),
        details: "Login succeeded.",
        ipAddress: request.headers.get("x-forwarded-for") ?? "unknown",
      },
    });

    return response;
  } catch (error) {
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}

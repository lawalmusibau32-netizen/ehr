import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeRoleKey } from "@/lib/roles";

export async function issueSessionResponse(
  user: { userId: number; username: string; roleName: string; email: string | null },
  request: Request,
  extraData?: Record<string, unknown>
): Promise<NextResponse> {
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
      role: user.roleName,
      roleKey: normalizeRoleKey(user.roleName),
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
      roleName: user.roleName,
      roleKey: normalizeRoleKey(user.roleName),
    },
    ...extraData,
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
}
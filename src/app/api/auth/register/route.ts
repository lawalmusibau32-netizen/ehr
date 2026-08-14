import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { registerSchema } from "@/lib/validations/auth";
import { verifyAccessToken, AUTH_COOKIE_NAME } from "@/lib/auth";
import { normalizeRoleKey } from "@/lib/roles";
import { isRateLimited } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    const rate = isRateLimited(request, 30, 60 * 1000);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfter) } }
      );
    }

    const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
    const authUser = token ? verifyAccessToken(token) : null;

    if (!authUser || normalizeRoleKey(authUser.role) !== "administrator") {
      return NextResponse.json({ error: "Administrator access required." }, { status: 403 });
    }

    const body = await request.json();
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 });
    }

    const { username, displayName, email, roleName, password } = parsed.data;

    const existing = await prisma.user.findFirst({
      where: { OR: [{ username: { equals: username } }, ...(email ? [{ email: { equals: email } }] : [])] },
    });
    if (existing) {
      if (existing.username === username) {
        return NextResponse.json({ error: "That username is already registered." }, { status: 400 });
      }
      return NextResponse.json({ error: "That email is already registered." }, { status: 400 });
    }

    const role = await prisma.role.findFirst({
      where: { roleName: { equals: roleName.charAt(0).toUpperCase() + roleName.slice(1).toLowerCase() } },
    });
    if (!role) {
      return NextResponse.json({ error: "Selected role does not exist." }, { status: 400 });
    }

    const passwordHash = bcrypt.hashSync(password, 12);

    const user = await prisma.user.create({
      data: {
        roleId: role.roleId,
        username,
        displayName,
        email: email || null,
        passwordHash,
      },
      include: { role: true },
    });

    await prisma.auditLog.create({
      data: {
        userId: authUser.sub,
        actionType: "CREATE",
        entityName: "users",
        entityId: String(user.userId),
        details: `Registered user ${user.username}.`,
        ipAddress: request.headers.get("x-forwarded-for") ?? "unknown",
      },
    });

    return NextResponse.json({
      message: "User registered successfully.",
      user: {
        userId: user.userId,
        username: user.username,
        displayName: user.displayName,
        email: user.email,
        roleName: user.role.roleName,
      },
    }, { status: 201 });
  } catch (e) {
    console.error("Register error:", e);
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}

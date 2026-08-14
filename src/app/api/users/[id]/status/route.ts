import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyAccessToken, AUTH_COOKIE_NAME } from "@/lib/auth";
import { normalizeRoleKey } from "@/lib/roles";
import { rateLimitResponse } from "@/lib/rate-limit";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const limited = rateLimitResponse(request, 60, 60 * 1000);
  if (limited) return limited;

  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const authUser = token ? verifyAccessToken(token) : null;

  if (!authUser || normalizeRoleKey(authUser.role) !== "administrator") {
    return NextResponse.json({ error: "Administrator access required." }, { status: 403 });
  }

  const userId = Number(id);
  if (authUser.sub === userId) {
    return NextResponse.json({ error: "You cannot deactivate your own account." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { userId } });
  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  const newStatus = user.isActive === "Y" ? "N" : "Y";

  await prisma.user.update({
    where: { userId },
    data: { isActive: newStatus },
  });

  await prisma.auditLog.create({
    data: {
      userId: authUser.sub,
      actionType: "UPDATE",
      entityName: "users",
      entityId: String(userId),
      details: `${newStatus === "Y" ? "Activated" : "Deactivated"} user ${user.username}.`,
      ipAddress: request.headers.get("x-forwarded-for") ?? "unknown",
    },
  });

  return NextResponse.json({ message: `User ${newStatus === "Y" ? "activated" : "deactivated"}.`, isActive: newStatus });
}

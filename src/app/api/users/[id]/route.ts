import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { verifyAccessToken, AUTH_COOKIE_NAME } from "@/lib/auth";
import { normalizeRoleKey } from "@/lib/roles";
import { rateLimitResponse } from "@/lib/rate-limit";

function getUser(request: Request) {
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyAccessToken(token);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const authUser = getUser(request);
  if (!authUser || normalizeRoleKey(authUser.role) !== "administrator") {
    return NextResponse.json({ error: "Administrator access required." }, { status: 403 });
  }

  const limited = rateLimitResponse(request, 60, 60 * 1000);
  if (limited) return limited;

  const userId = Number(id);
  if (authUser.sub === userId) {
    return NextResponse.json({ error: "You cannot delete your own account." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { userId } });
  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  const hasMedicalRecords = await prisma.medicalRecord.count({ where: { createdByUserId: userId } });
  const hasAppointments = await prisma.appointment.count({ where: { OR: [{ scheduledByUserId: userId }, { clinicianUserId: userId }] } });
  if (hasMedicalRecords > 0 || hasAppointments > 0) {
    return NextResponse.json({
      error: "Cannot delete user with existing clinical records or appointments. Deactivate them instead.",
    }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.authSession.deleteMany({ where: { userId } });
    await tx.auditLog.updateMany({ where: { userId }, data: { userId: null } });
    await tx.user.delete({ where: { userId } });
  });

  await prisma.auditLog.create({
    data: {
      userId: authUser.sub,
      actionType: "DELETE",
      entityName: "users",
      entityId: String(userId),
      details: `Deleted user ${user.username}.`,
      ipAddress: request.headers.get("x-forwarded-for") ?? "unknown",
    },
  });

  return NextResponse.json({ message: "User deleted." });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const authUser = getUser(request);
  if (!authUser || normalizeRoleKey(authUser.role) !== "administrator") {
    return NextResponse.json({ error: "Administrator access required." }, { status: 403 });
  }

  const limited = rateLimitResponse(request, 60, 60 * 1000);
  if (limited) return limited;

  const userId = Number(id);
  const body = await request.json();
  const { displayName, email, roleId, password } = body;

  const existing = await prisma.user.findUnique({ where: { userId } });
  if (!existing) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  if (email !== undefined && email !== existing.email) {
    const emailTaken = await prisma.user.findFirst({ where: { email: { equals: email }, userId: { not: userId } } });
    if (emailTaken) {
      return NextResponse.json({ error: "That email is already in use." }, { status: 400 });
    }
  }

  const updateData: Record<string, unknown> = {};
  if (displayName !== undefined) updateData.displayName = displayName;
  if (email !== undefined) updateData.email = email || null;
  if (roleId !== undefined) updateData.roleId = roleId;

  if (password) {
    if (password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters." }, { status: 400 });
    }
    updateData.passwordHash = bcrypt.hashSync(password, 12);
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "No fields to update." }, { status: 400 });
  }

  const user = await prisma.user.update({
    where: { userId },
    data: updateData,
    include: { role: true },
  });

  await prisma.auditLog.create({
    data: {
      userId: authUser.sub,
      actionType: "UPDATE",
      entityName: "users",
      entityId: String(userId),
      details: `Updated user ${user.username}${password ? " (password reset)" : ""}.`,
      ipAddress: request.headers.get("x-forwarded-for") ?? "unknown",
    },
  });

  return NextResponse.json({
    message: "User updated.",
    user: {
      userId: user.userId,
      username: user.username,
      displayName: user.displayName,
      email: user.email,
      roleName: user.role.roleName,
      roleId: user.roleId,
    },
  });
}

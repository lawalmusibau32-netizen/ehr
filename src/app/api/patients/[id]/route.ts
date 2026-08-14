import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { AUTH_COOKIE_NAME, verifyAccessToken } from "@/lib/auth";
import { patientSchema } from "@/lib/validations/patient";
import { encryptValue, decryptValue } from "@/lib/crypto";
import { rateLimitResponse } from "@/lib/rate-limit";

const READ_ROLES = ["administrator", "doctor", "nurse", "receptionist"];
const WRITE_ROLES = ["administrator", "doctor", "receptionist"];

function getUser(request: Request) {
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyAccessToken(token);
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = getUser(request);
  if (!user || !READ_ROLES.includes(user.roleKey)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const patient = await prisma.patient.findUnique({ where: { patientId: Number(id) } });
  if (!patient) {
    return NextResponse.json({ error: "Patient not found." }, { status: 404 });
  }

  const encryptedFields = ["phoneNumber", "email", "addressLine1", "addressLine2", "city", "region"] as const;
  const decrypted = { ...patient };
  for (const field of encryptedFields) {
    const val = (decrypted as Record<string, unknown>)[field];
    if (typeof val === "string") {
      (decrypted as Record<string, unknown>)[field] = decryptValue(val);
    }
  }

  return NextResponse.json({ patient: decrypted });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = getUser(request);
  if (!user || !WRITE_ROLES.includes(user.roleKey)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const limited = rateLimitResponse(request, 60, 60 * 1000);
  if (limited) return limited;

  try {
    const body = await request.json();
    const parsed = patientSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 });
    }

    const data = parsed.data;
    const patientId = Number(id);

    const existing = await prisma.patient.findFirst({
      where: { mrn: data.mrn, patientId: { not: patientId } },
    });
    if (existing) {
      return NextResponse.json({ error: "That MRN already exists." }, { status: 400 });
    }

    const allowStatusChange = normalizeRoleKey(user.role) === "administrator";

    const patient = await prisma.patient.update({
      where: { patientId },
      data: {
        mrn: data.mrn,
        firstName: data.firstName,
        lastName: data.lastName,
        dateOfBirth: new Date(data.dateOfBirth),
        sex: data.sex,
        phoneNumber: encryptValue(data.phoneNumber || null),
        email: encryptValue(data.email || null),
        addressLine1: encryptValue(data.addressLine1 || null),
        addressLine2: encryptValue(data.addressLine2 || null),
        city: encryptValue(data.city || null),
        region: encryptValue(data.region || null),
        country: data.country || "Ghana",
        ...(allowStatusChange && data.isActive
          ? { isActive: ["Y", "on", "1", "true"].includes(data.isActive) ? "Y" : "N" }
          : {}),
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: user.sub,
        actionType: "UPDATE",
        entityName: "patients",
        entityId: String(patientId),
        details: `Updated patient ${patient.mrn}.`,
        ipAddress: request.headers.get("x-forwarded-for") ?? "unknown",
      },
    });

    const encryptedFields = ["phoneNumber", "email", "addressLine1", "addressLine2", "city", "region"] as const;
    const decrypted = { ...patient };
    for (const field of encryptedFields) {
      const val = (decrypted as Record<string, unknown>)[field];
      if (typeof val === "string") {
        (decrypted as Record<string, unknown>)[field] = decryptValue(val);
      }
    }

    return NextResponse.json({ patient: decrypted });
  } catch (error) {
    return NextResponse.json({ error: "Failed to update patient." }, { status: 400 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = getUser(request);
  if (!user || normalizeRoleKey(user.role) !== "administrator") {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const limited = rateLimitResponse(request, 60, 60 * 1000);
  if (limited) return limited;

  const patientId = Number(id);
  const patient = await prisma.patient.findUnique({ where: { patientId } });
  if (!patient) {
    return NextResponse.json({ error: "Patient not found." }, { status: 404 });
  }

  await prisma.patient.update({
    where: { patientId },
    data: { isActive: "N" },
  });

  await prisma.auditLog.create({
    data: {
      userId: user.sub,
      actionType: "DELETE",
      entityName: "patients",
      entityId: String(patientId),
      details: `Deactivated patient ${patient.mrn}.`,
      ipAddress: request.headers.get("x-forwarded-for") ?? "unknown",
    },
  });

  return NextResponse.json({ message: "Patient deactivated." });
}

function normalizeRoleKey(role: string): string {
  const aliases: Record<string, string> = {
    administrator: "administrator",
    admin: "administrator",
    doctor: "doctor",
    clinician: "doctor",
    nurse: "nurse",
    receptionist: "receptionist",
  };
  return aliases[role.trim().toLowerCase()] ?? role.trim().toLowerCase();
}

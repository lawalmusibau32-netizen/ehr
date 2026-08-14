import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { AUTH_COOKIE_NAME, verifyAccessToken } from "@/lib/auth";
import { patientSchema } from "@/lib/validations/patient";
import { encryptValue, decryptValue } from "@/lib/crypto";
import { isRateLimited } from "@/lib/rate-limit";

const ENCRYPTED_FIELDS = ["phoneNumber", "email", "addressLine1", "addressLine2", "city", "region"] as const;

const READ_ROLES = ["administrator", "doctor", "nurse", "receptionist"];
const WRITE_ROLES = ["administrator", "doctor", "receptionist"];

function getUser(request: Request) {
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyAccessToken(token);
}

function decryptPatient(patient: Record<string, unknown>) {
  const copy = { ...patient };
  for (const field of ENCRYPTED_FIELDS) {
    const val = copy[field];
    if (typeof val === "string") {
      copy[field] = decryptValue(val);
    }
  }
  return copy;
}

export async function GET(request: Request) {
  const user = getUser(request);
  if (!user || !READ_ROLES.includes(user.roleKey)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("q")?.trim() ?? "";
  const includeInactive = searchParams.get("include_inactive") === "1";

  const patients = await prisma.patient.findMany({
    where: {
      ...(search
        ? {
            OR: [
              { mrn: { contains: search } },
              { firstName: { contains: search } },
              { lastName: { contains: search } },
            ],
          }
        : {}),
      ...(includeInactive ? {} : { isActive: "Y" }),
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });

  return NextResponse.json({ patients: patients.map(decryptPatient) });
}

export async function POST(request: Request) {
  const user = getUser(request);
  if (!user || !WRITE_ROLES.includes(user.roleKey)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const rate = isRateLimited(request, 60, 60 * 1000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfter) } }
    );
  }

  try {
    const body = await request.json();
    const parsed = patientSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 });
    }

    const data = parsed.data;

    const existing = await prisma.patient.findUnique({ where: { mrn: data.mrn } });
    if (existing) {
      return NextResponse.json({ error: "That MRN already exists." }, { status: 400 });
    }

    const patient = await prisma.patient.create({
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
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: user.sub,
        actionType: "CREATE",
        entityName: "patients",
        entityId: String(patient.patientId),
        details: `Created patient ${patient.mrn}.`,
        ipAddress: request.headers.get("x-forwarded-for") ?? "unknown",
      },
    });

    return NextResponse.json({ patient }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Failed to create patient." }, { status: 400 });
  }
}

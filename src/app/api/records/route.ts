import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { AUTH_COOKIE_NAME, verifyAccessToken } from "@/lib/auth";
import { isRateLimited } from "@/lib/rate-limit";

function getUser(request: Request) {
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyAccessToken(token);
}

export async function GET(request: Request) {
  const user = getUser(request);
  if (!user || !["administrator", "doctor", "nurse"].includes(user.roleKey)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("q")?.trim() ?? "";
  const patientId = searchParams.get("patient_id") ? Number(searchParams.get("patient_id")) : undefined;
  const recordType = searchParams.get("record_type") || undefined;
  const recordStatus = searchParams.get("record_status") || undefined;

  const where: Record<string, unknown> = {};
  if (patientId) where.patientId = patientId;
  if (recordType) where.recordType = recordType;
  if (recordStatus) where.recordStatus = recordStatus;
  if (search) {
    where.OR = [
      { title: { contains: search } },
      { patient: { mrn: { contains: search } } },
      { patient: { firstName: { contains: search } } },
      { patient: { lastName: { contains: search } } },
    ];
  }

  const records = await prisma.medicalRecord.findMany({
    where,
    include: {
      patient: { select: { patientId: true, mrn: true, firstName: true, lastName: true } },
      patientRecord: { select: { displayName: true } },
      _count: {
        select: {
          diagnoses: { where: { isActive: "Y" } },
          prescriptions: { where: { isActive: "Y" } },
          treatments: { where: { isActive: "Y" } },
        },
      },
    },
    orderBy: { encounterDate: "desc" },
  });

  const mapped = records.map((r) => ({
    ...r,
    createdByName: r.patientRecord.displayName,
    diagnosisCount: r._count.diagnoses,
    prescriptionCount: r._count.prescriptions,
    treatmentCount: r._count.treatments,
    patientRecord: undefined,
    _count: undefined,
  }));

  return NextResponse.json({ records: mapped });
}

export async function POST(request: Request) {
  const user = getUser(request);
  if (!user || !["administrator", "doctor", "nurse"].includes(user.roleKey)) {
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

    const record = await prisma.medicalRecord.create({
      data: {
        patientId: Number(body.patientId),
        createdByUserId: user.sub,
        recordType: body.recordType,
        title: body.title,
        clinicalNote: body.clinicalNote,
        recordStatus: body.recordStatus ?? "ACTIVE",
        encounterDate: body.encounterDate ? new Date(body.encounterDate) : new Date(),
      },
      include: { patient: { select: { mrn: true } } },
    });

    await prisma.auditLog.create({
      data: {
        userId: user.sub,
        actionType: "CREATE",
        entityName: "medical_records",
        entityId: String(record.recordId),
        details: `Created record for MRN ${record.patient.mrn}.`,
        ipAddress: request.headers.get("x-forwarded-for") ?? "unknown",
      },
    });

    return NextResponse.json({ record }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Failed to create record." }, { status: 400 });
  }
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { AUTH_COOKIE_NAME, verifyAccessToken } from "@/lib/auth";
import { appointmentSchema } from "@/lib/validations/appointment";
import { isRateLimited } from "@/lib/rate-limit";

function getUser(request: Request) {
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyAccessToken(token);
}

export async function GET(request: Request) {
  const user = getUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("q")?.trim() ?? "";
  const status = searchParams.get("status") || undefined;
  const patientId = searchParams.get("patient_id") ? Number(searchParams.get("patient_id")) : undefined;

  const where: Record<string, unknown> = {};

  if (status) where.status = status;
  if (patientId) where.patientId = patientId;
  if (search) {
    where.OR = [
      { patient: { mrn: { contains: search } } },
      { patient: { firstName: { contains: search } } },
      { patient: { lastName: { contains: search } } },
    ];
  }

  const appointments = await prisma.appointment.findMany({
    where,
    include: {
      patient: { select: { patientId: true, mrn: true, firstName: true, lastName: true } },
      clinician: { select: { userId: true, displayName: true } },
      scheduler: { select: { userId: true, displayName: true } },
    },
    orderBy: { appointmentDate: "desc" },
  });

  return NextResponse.json({ appointments });
}

export async function POST(request: Request) {
  const user = getUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const rate = isRateLimited(request, 60, 60 * 1000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfter) } }
    );
  }

  try {
    const body = await request.json();
    const parsed = appointmentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 });
    }

    const data = parsed.data;

    const patient = await prisma.patient.findUnique({ where: { patientId: data.patientId } });
    if (!patient || patient.isActive !== "Y") {
      return NextResponse.json({ error: "Selected patient is inactive or does not exist." }, { status: 400 });
    }

    const appointment = await prisma.appointment.create({
      data: {
        patientId: data.patientId,
        scheduledByUserId: user.sub,
        clinicianUserId: data.clinicianUserId || null,
        appointmentDate: new Date(data.appointmentDate),
        appointmentType: data.appointmentType,
        status: data.status ?? "SCHEDULED",
        reason: data.reason || null,
        location: data.location || null,
        notes: data.notes || null,
      },
      include: {
        patient: { select: { mrn: true } },
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: user.sub,
        actionType: "CREATE",
        entityName: "appointments",
        entityId: String(appointment.appointmentId),
        details: `Scheduled appointment for MRN ${appointment.patient.mrn}.`,
        ipAddress: request.headers.get("x-forwarded-for") ?? "unknown",
      },
    });

    return NextResponse.json({ appointment }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Failed to create appointment." }, { status: 400 });
  }
}

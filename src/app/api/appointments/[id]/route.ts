import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { AUTH_COOKIE_NAME, verifyAccessToken } from "@/lib/auth";
import { appointmentSchema } from "@/lib/validations/appointment";
import { rateLimitResponse } from "@/lib/rate-limit";

function getUser(request: Request) {
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyAccessToken(token);
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = getUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const appointment = await prisma.appointment.findUnique({
    where: { appointmentId: Number(id) },
    include: {
      patient: true,
      clinician: { select: { userId: true, displayName: true } },
      scheduler: { select: { userId: true, displayName: true } },
    },
  });

  if (!appointment) {
    return NextResponse.json({ error: "Appointment not found." }, { status: 404 });
  }

  return NextResponse.json({ appointment });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = getUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const limited = rateLimitResponse(request, 60, 60 * 1000);
  if (limited) return limited;

  try {
    const body = await request.json();
    const parsed = appointmentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 });
    }

    const data = parsed.data;
    const appointmentId = Number(id);

    const current = await prisma.appointment.findUnique({ where: { appointmentId } });
    if (!current) return NextResponse.json({ error: "Appointment not found." }, { status: 404 });
    if (current.status === "CANCELLED") {
      return NextResponse.json({ error: "Cancelled appointments cannot be updated." }, { status: 400 });
    }

    const appointment = await prisma.appointment.update({
      where: { appointmentId },
      data: {
        patientId: data.patientId,
        clinicianUserId: data.clinicianUserId || null,
        appointmentDate: new Date(data.appointmentDate),
        appointmentType: data.appointmentType,
        status: data.status ?? current.status,
        reason: data.reason || null,
        location: data.location || null,
        notes: data.notes || null,
      },
      include: { patient: { select: { mrn: true } } },
    });

    await prisma.auditLog.create({
      data: {
        userId: user.sub,
        actionType: "UPDATE",
        entityName: "appointments",
        entityId: String(appointmentId),
        details: `Updated appointment for MRN ${appointment.patient.mrn}.`,
        ipAddress: request.headers.get("x-forwarded-for") ?? "unknown",
      },
    });

    return NextResponse.json({ appointment });
  } catch {
    return NextResponse.json({ error: "Failed to update appointment." }, { status: 400 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = getUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const limited = rateLimitResponse(request, 60, 60 * 1000);
  if (limited) return limited;

  const appointmentId = Number(id);
  const body = await request.json().catch(() => ({}));
  const cancelNote = body.cancel_note || null;

  const current = await prisma.appointment.findUnique({ where: { appointmentId } });
  if (!current) return NextResponse.json({ error: "Appointment not found." }, { status: 404 });
  if (current.status === "CANCELLED") {
    return NextResponse.json({ error: "Appointment is already cancelled." }, { status: 400 });
  }

  await prisma.appointment.update({
    where: { appointmentId },
    data: {
      status: "CANCELLED",
      notes: cancelNote ? `${current.notes ?? ""}\n${cancelNote}`.trim() : current.notes,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: user.sub,
      actionType: "DELETE",
      entityName: "appointments",
      entityId: String(appointmentId),
      details: "Cancelled appointment.",
      ipAddress: request.headers.get("x-forwarded-for") ?? "unknown",
    },
  });

  return NextResponse.json({ message: "Appointment cancelled." });
}

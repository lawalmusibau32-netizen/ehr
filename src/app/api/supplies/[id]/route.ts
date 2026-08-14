import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { AUTH_COOKIE_NAME, verifyAccessToken } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { normalizeRoleKey } from "@/lib/roles";
import { supplySchema } from "@/lib/validations/inventory";
import { rateLimitResponse } from "@/lib/rate-limit";

const READ_ROLES = ["administrator", "doctor", "nurse", "receptionist"];
const WRITE_ROLES = ["administrator", "receptionist"];

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

  const supply = await prisma.inventorySupply.findUnique({ where: { supplyId: Number(id) } });
  if (!supply) {
    return NextResponse.json({ error: "Supply not found." }, { status: 404 });
  }

  return NextResponse.json({ supply });
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
    const parsed = supplySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 });
    }

    const data = parsed.data;
    const supplyId = Number(id);

    const supply = await prisma.inventorySupply.update({
      where: { supplyId },
      data: {
        name: data.name,
        category: data.category,
        quantity: data.quantity,
        unit: data.unit,
        reorderLevel: data.reorderLevel,
        unitCost: data.unitCost ?? null,
        expiryDate: data.expiryDate ? new Date(data.expiryDate) : null,
        batchNumber: data.batchNumber || null,
        manufacturer: data.manufacturer || null,
        notes: data.notes || null,
      },
    });

    audit(user.sub, "UPDATE", "inventory_supplies", String(supplyId), `Updated supply: ${supply.name}`, request.headers.get("x-forwarded-for") ?? "unknown");

    return NextResponse.json({ supply });
  } catch {
    return NextResponse.json({ error: "Failed to update supply." }, { status: 400 });
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

  const supplyId = Number(id);
  const supply = await prisma.inventorySupply.findUnique({ where: { supplyId } });
  if (!supply) {
    return NextResponse.json({ error: "Supply not found." }, { status: 404 });
  }

  await prisma.inventorySupply.update({
    where: { supplyId },
    data: { isActive: "N" },
  });

  audit(user.sub, "DELETE", "inventory_supplies", String(supplyId), `Deactivated supply: ${supply.name}`, request.headers.get("x-forwarded-for") ?? "unknown");

  return NextResponse.json({ message: "Supply deactivated." });
}

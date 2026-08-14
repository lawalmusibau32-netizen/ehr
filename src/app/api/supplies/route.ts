import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { AUTH_COOKIE_NAME, verifyAccessToken } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { normalizeRoleKey } from "@/lib/roles";
import { supplySchema } from "@/lib/validations/inventory";
import { isRateLimited } from "@/lib/rate-limit";

const READ_ROLES = ["administrator", "doctor", "nurse", "receptionist"];
const WRITE_ROLES = ["administrator", "receptionist"];

function getUser(request: Request) {
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyAccessToken(token);
}

export async function GET(request: Request) {
  const user = getUser(request);
  if (!user || !READ_ROLES.includes(user.roleKey)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category");
  const lowStock = searchParams.get("low_stock") === "1";
  const search = searchParams.get("q")?.trim() ?? "";

  const supplies = await prisma.inventorySupply.findMany({
    where: {
      isActive: "Y",
      ...(search
        ? { name: { contains: search, mode: "insensitive" } }
        : {}),
      ...(category ? { category } : {}),
      ...(lowStock ? { quantity: { lte: prisma.inventorySupply.fields.reorderLevel } } : {}),
    },
    orderBy: [{ name: "asc" }],
  });

  return NextResponse.json({ supplies });
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
    const parsed = supplySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 });
    }

    const data = parsed.data;

    const supply = await prisma.inventorySupply.create({
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

    audit(user.sub, "CREATE", "inventory_supplies", String(supply.supplyId), `Added supply: ${supply.name}`, request.headers.get("x-forwarded-for") ?? "unknown");

    return NextResponse.json({ supply }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Failed to create supply." }, { status: 400 });
  }
}

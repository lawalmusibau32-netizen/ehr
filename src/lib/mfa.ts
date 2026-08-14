import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import { prisma } from "@/lib/prisma";

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const PENDING_TOKEN_TTL_MINUTES = 5;
const RECOVERY_CODE_COUNT = 10;

function getSecret(): string {
  return process.env.JWT_SECRET_KEY ?? process.env.SECRET_KEY ?? "change-this-in-production";
}

export function generateOtp(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function hashOtp(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

export function hashRecoveryCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT ?? "587", 10),
    secure: process.env.SMTP_SECURE === "1",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

export async function sendOtpEmail(to: string, code: string): Promise<void> {
  const transporter = getTransporter();
  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
    to,
    subject: "Your HealthIQ EHR verification code",
    text: `Your verification code is ${code}. It expires in 10 minutes. If you did not request this, contact your administrator immediately.`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px;">
        <h2 style="margin-top: 0; color: #0f172a;">HealthIQ EHR Verification</h2>
        <p style="color: #334155;">Your verification code is:</p>
        <div style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #0f172a; background: #f1f5f9; padding: 16px; border-radius: 8px; text-align: center;">${code}</div>
        <p style="color: #64748b; font-size: 13px;">This code expires in 10 minutes. If you did not request this, contact your administrator immediately.</p>
      </div>
    `,
  });
}

export function createPendingToken(userId: number, purpose: "enroll" | "challenge"): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { sub: userId, purpose, type: "mfa_pending", iat: now, exp: now + PENDING_TOKEN_TTL_MINUTES * 60 },
    getSecret(),
    { algorithm: "HS256" }
  );
}

export function verifyPendingToken(token: string, purpose: "enroll" | "challenge"): number | null {
  try {
    const payload = jwt.verify(token, getSecret(), { algorithms: ["HS256"] }) as {
      sub: number;
      purpose: string;
      type: string;
    };
    if (payload.type !== "mfa_pending" || payload.purpose !== purpose) return null;
    return payload.sub;
  } catch {
    return null;
  }
}

export function generateRecoveryCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    codes.push(crypto.randomBytes(5).toString("hex").toUpperCase());
  }
  return codes;
}

export function storeRecoveryCodes(userId: number, codes: string[]) {
  const hashed = codes.map(hashRecoveryCode);
  return prisma.user.update({
    where: { userId },
    data: { mfaRecoveryCodes: JSON.stringify(hashed) },
  });
}

export async function consumeRecoveryCode(userId: number, inputCode: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { userId } });
  if (!user?.mfaRecoveryCodes) return false;

  const hashed = hashRecoveryCode(inputCode.trim().toUpperCase());
  const codes: string[] = JSON.parse(user.mfaRecoveryCodes);
  const idx = codes.indexOf(hashed);
  if (idx === -1) return false;

  codes.splice(idx, 1);
  await prisma.user.update({
    where: { userId },
    data: { mfaRecoveryCodes: JSON.stringify(codes) },
  });
  return true;
}

export function isOtpLocked(user: {
  otpAttempts: number;
  otpExpiresAt: Date | null;
}): boolean {
  return user.otpAttempts >= OTP_MAX_ATTEMPTS && !!user.otpExpiresAt && user.otpExpiresAt > new Date();
}

export const OTP_TTL_MS_VALUE = OTP_TTL_MS;
export const OTP_MAX_ATTEMPTS_VALUE = OTP_MAX_ATTEMPTS;
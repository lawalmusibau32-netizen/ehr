import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const KEY_LENGTH = 32;
const ENCRYPTED_PREFIX = "enc:v1:";

export class EncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncryptionError";
  }
}

export function generateEncryptionKey(): string {
  return crypto.randomBytes(KEY_LENGTH).toString("base64url");
}

function getKey(): Buffer {
  const key = process.env.EHR_ENCRYPTION_KEY;
  if (!key) throw new EncryptionError("EHR_ENCRYPTION_KEY is not configured.");
  try {
    const raw = Buffer.from(key, "base64url");
    if (raw.length !== KEY_LENGTH) throw new Error("wrong length");
    return raw;
  } catch {
    throw new EncryptionError("EHR_ENCRYPTION_KEY must be a 32-byte base64url-encoded key.");
  }
}

export function encryptValue(value: string | null | undefined): string | null | undefined {
  if (!value) return value;
  if (typeof value === "string" && value.startsWith(ENCRYPTED_PREFIX)) return value;

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);

  let encrypted = cipher.update(value, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");

  return `${ENCRYPTED_PREFIX}${iv.toString("hex")}:${tag}:${encrypted}`;
}

export function decryptValue(value: string | null | undefined): string | null | undefined {
  if (!value) return value;
  if (typeof value !== "string" || !value.startsWith(ENCRYPTED_PREFIX)) return value;

  const payload = value.slice(ENCRYPTED_PREFIX.length);
  const parts = payload.split(":");
  if (parts.length < 3) throw new EncryptionError("Invalid encrypted value format.");

  const iv = Buffer.from(parts[0], "hex");
  const tag = Buffer.from(parts[1], "hex");
  const encrypted = parts.slice(2).join(":");

  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

export function decryptObject<T extends Record<string, unknown>>(obj: T | null, fields: (keyof T)[]): T | null {
  if (!obj) return obj;
  const copy = { ...obj };
  for (const field of fields) {
    const val = copy[field];
    if (typeof val === "string") {
      (copy as Record<string, unknown>)[field] = decryptValue(val) as T[keyof T];
    }
  }
  return copy;
}

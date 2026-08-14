import { z } from "zod";

export const loginSchema = z.object({
  username: z.string().min(1, "Username is required."),
  password: z.string().min(1, "Password is required."),
  mfaCode: z.string().optional(),
});

export const registerSchema = z.object({
  username: z.string().min(1, "Username is required.").max(50),
  displayName: z.string().min(1, "Display name is required.").max(120),
  email: z.string().email("Invalid email.").min(1, "Email is required — MFA codes are sent to it."),
  roleName: z.string().min(1, "Role is required."),
  password: z.string().min(6, "Password must be at least 6 characters."),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;

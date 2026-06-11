// packages/types/src/user.ts
import { z } from 'zod'

// ── Core user record (as stored / returned from the gateway) ──────────────────

export const UserSchema = z.object({
  id:        z.string().uuid(),
  email:     z.string().email(),
  name:      z.string().min(1).max(256).optional(),
  status:    z.enum(['active', 'suspended', 'pending_verification']),
  mfaEnabled: z.boolean().default(false),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export type User = z.infer<typeof UserSchema>

// ── Registration ──────────────────────────────────────────────────────────────

export const RegisterRequestSchema = z.object({
  email:    z.string().email({ message: 'Invalid email address' }),
  password: z
    .string()
    .min(12, 'Password must be at least 12 characters')
    .max(128, 'Password must be at most 128 characters'),
  name:     z.string().min(1).max(256).optional(),
})

export type RegisterRequest = z.infer<typeof RegisterRequestSchema>

export const RegisterResponseSchema = z.object({
  user:    UserSchema,
  message: z.string(),
})

export type RegisterResponse = z.infer<typeof RegisterResponseSchema>

// ── Login ─────────────────────────────────────────────────────────────────────

export const LoginRequestSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
})

export type LoginRequest = z.infer<typeof LoginRequestSchema>

/** Returned when login succeeds without MFA, or after MFA is verified. */
export const LoginSuccessResponseSchema = z.object({
  accessToken:  z.string(),
  refreshToken: z.string(),
  expiresIn:    z.number().int().positive(),  // seconds
  tokenType:    z.literal('Bearer').default('Bearer'),
})

export type LoginSuccessResponse = z.infer<typeof LoginSuccessResponseSchema>

/** Returned (HTTP 202) when MFA challenge is required after password check. */
export const MfaChallengeResponseSchema = z.object({
  challengeId: z.string().uuid(),
  type:        z.enum(['totp']),
})

export type MfaChallengeResponse = z.infer<typeof MfaChallengeResponseSchema>

// ── Token refresh ─────────────────────────────────────────────────────────────

export const RefreshRequestSchema = z.object({
  refreshToken: z.string().min(1),
})

export type RefreshRequest = z.infer<typeof RefreshRequestSchema>

// ── Logout ────────────────────────────────────────────────────────────────────

export const LogoutRequestSchema = z.object({
  refreshToken: z.string().min(1).optional(),
})

export type LogoutRequest = z.infer<typeof LogoutRequestSchema>

// ── Password reset ────────────────────────────────────────────────────────────

export const ForgotPasswordRequestSchema = z.object({
  email: z.string().email(),
})

export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequestSchema>

export const ResetPasswordRequestSchema = z.object({
  token:    z.string().min(1),
  password: z
    .string()
    .min(12, 'Password must be at least 12 characters')
    .max(128, 'Password must be at most 128 characters'),
})

export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequestSchema>

// packages/types/src/token.ts
import { z } from 'zod'

// ── JWT access token claims (what services extract after jwtVerify) ───────────

export const AccessTokenPayloadSchema = z.object({
  sub:   z.string().uuid(),          // user ID
  email: z.string().email(),
  scope: z.string(),                  // space-delimited, e.g. "openid profile email"
  iss:   z.string().url(),            // gateway issuer URL
  aud:   z.union([z.string(), z.array(z.string())]),
  iat:   z.number().int(),
  exp:   z.number().int(),
  jti:   z.string().uuid(),           // unique token ID (used for revocation check)
})

export type AccessTokenPayload = z.infer<typeof AccessTokenPayloadSchema>

// ── ID token claims (OIDC) ────────────────────────────────────────────────────

export const IdTokenPayloadSchema = AccessTokenPayloadSchema.extend({
  name:    z.string().optional(),
  picture: z.string().url().optional(),
  email_verified: z.boolean().optional(),
})

export type IdTokenPayload = z.infer<typeof IdTokenPayloadSchema>

// ── MFA ───────────────────────────────────────────────────────────────────────

export const MfaEnrollRequestSchema = z.object({
  // nothing required in body — user is identified by their access token
})

export type MfaEnrollRequest = z.infer<typeof MfaEnrollRequestSchema>

export const MfaEnrollResponseSchema = z.object({
  secret:      z.string(),   // base32 TOTP secret — shown to user once
  otpauthUrl:  z.string(),   // otpauth:// URI for QR code rendering
  backupCodes: z.array(z.string()).length(8),
})

export type MfaEnrollResponse = z.infer<typeof MfaEnrollResponseSchema>

export const MfaVerifyRequestSchema = z.object({
  challengeId: z.string().uuid(),
  code:        z.string().length(6).regex(/^\d{6}$/, 'TOTP code must be 6 digits'),
})

export type MfaVerifyRequest = z.infer<typeof MfaVerifyRequestSchema>

// ── OAuth / OIDC ──────────────────────────────────────────────────────────────

export const OAuthTokenRequestSchema = z.discriminatedUnion('grant_type', [
  z.object({
    grant_type:    z.literal('authorization_code'),
    code:          z.string().min(1),
    redirect_uri:  z.string().url(),
    code_verifier: z.string().min(43).max(128),  // PKCE verifier (RFC 7636)
    client_id:     z.string().min(1),
  }),
  z.object({
    grant_type:    z.literal('refresh_token'),
    refresh_token: z.string().min(1),
    client_id:     z.string().min(1),
  }),
])

export type OAuthTokenRequest = z.infer<typeof OAuthTokenRequestSchema>

export const OAuthTokenResponseSchema = z.object({
  access_token:  z.string(),
  token_type:    z.literal('Bearer'),
  expires_in:    z.number().int().positive(),
  refresh_token: z.string().optional(),
  id_token:      z.string().optional(),
  scope:         z.string(),
})

export type OAuthTokenResponse = z.infer<typeof OAuthTokenResponseSchema>

export const UserInfoResponseSchema = z.object({
  sub:            z.string().uuid(),
  email:          z.string().email(),
  email_verified: z.boolean(),
  name:           z.string().optional(),
  picture:        z.string().url().optional(),
})

export type UserInfoResponse = z.infer<typeof UserInfoResponseSchema>
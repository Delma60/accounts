// packages/types/src/errors.ts
import { z } from 'zod'

// ── Standard error envelope (§15.1 of AGENTS.md) ─────────────────────────────

export const ErrorResponseSchema = z.object({
  error:             z.string(),
  error_description: z.string().optional(),
  request_id:        z.string().uuid().optional(),
})

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>

// ── OAuth RFC 6749 error codes ────────────────────────────────────────────────

export const OAuthErrorCode = z.enum([
  'invalid_request',
  'invalid_client',
  'invalid_grant',
  'unauthorized_client',
  'unsupported_grant_type',
  'invalid_scope',
  'access_denied',
  'server_error',
  'temporarily_unavailable',
])

export type OAuthErrorCode = z.infer<typeof OAuthErrorCode>
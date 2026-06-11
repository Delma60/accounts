// packages/utils/src/verify-token.ts
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import { type AccessTokenPayload, AccessTokenPayloadSchema } from '@app/types'

// ── JWKS cache (one per process; auto-refreshes on key rotation) ──────────────

let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null

function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (_jwks) return _jwks

  const gatewayUrl = process.env.GATEWAY_URL
  if (!gatewayUrl) throw new Error('GATEWAY_URL env var is required for token verification.')

  _jwks = createRemoteJWKSet(new URL(`${gatewayUrl}/.well-known/jwks.json`))
  return _jwks
}

export interface VerifyOptions {
  /** Overrides GATEWAY_ISSUER env var. Useful in tests. */
  issuer?:   string
  /** Overrides SERVICE_NAME env var. */
  audience?: string
}

export interface VerifyResult {
  payload: AccessTokenPayload
  /** Raw jose payload — available if you need claims outside the typed schema */
  raw:     JWTPayload
}

/**
 * Verifies a JWT access token against the gateway's JWKS.
 *
 * - Validates signature, issuer, audience, and expiry locally — no round-trip.
 * - Parses claims through the AccessTokenPayloadSchema Zod schema.
 * - Throws if the token is invalid, expired, or fails schema validation.
 *
 * Usage in a Fastify service:
 *
 *   const { payload } = await verifyAccessToken(request.headers.authorization?.slice(7) ?? '')
 *   // payload.sub → user ID, payload.scope → space-delimited scopes
 */
export async function verifyAccessToken(
  token:   string,
  options: VerifyOptions = {},
): Promise<VerifyResult> {
  const issuer   = options.issuer   ?? process.env.GATEWAY_ISSUER
  const audience = options.audience ?? process.env.SERVICE_NAME

  if (!issuer)   throw new Error('GATEWAY_ISSUER env var is required.')
  if (!audience) throw new Error('SERVICE_NAME env var is required.')

  const { payload: raw } = await jwtVerify(token, getJwks(), {
    issuer,
    audience,
    algorithms: ['EdDSA'],
  })

  // Parse through Zod to guarantee the shape consumers rely on
  const payload = AccessTokenPayloadSchema.parse(raw)

  return { payload, raw }
}

/**
 * Extracts the Bearer token from an Authorization header value.
 * Returns null if the header is missing or not a Bearer token.
 */
export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null
  return authHeader.slice(7)
}

/**
 * Resets the cached JWKS instance. Use in tests when you need to
 * point at a different gateway URL between test suites.
 */
export function resetJwksCache(): void {
  _jwks = null
}
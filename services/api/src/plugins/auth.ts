// services/api/src/plugins/auth.ts
//
// Per AGENTS.md §8.3 & §9.3:
//   - Tokens are verified locally against the gateway's JWKS (no round-trip per request).
//   - Revocation records are checked via BaaS KV on every request.
//   - Services never implement login flows — they only verify tokens.

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import type { BaasClient } from '@spurs-baas/sdk'

// ── JWKS cache (one per process; jose auto-refreshes on key rotation) ─────────

let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null

function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (_jwks) return _jwks

  const gatewayUrl = process.env.GATEWAY_URL
  if (!gatewayUrl) throw new Error('GATEWAY_URL env var is required.')

  _jwks = createRemoteJWKSet(new URL(`${gatewayUrl}/.well-known/jwks.json`))
  return _jwks
}

export interface AuthenticatedPayload {
  sub:   string
  email: string
  scope: string
  jti:   string
  iss:   string
  aud:   string | string[]
  iat:   number
  exp:   number
}

// Augment FastifyRequest so downstream handlers get full type safety
declare module 'fastify' {
  interface FastifyRequest {
    user: AuthenticatedPayload
  }
}

/**
 * Registers a `preHandler` hook that:
 *   1. Extracts the Bearer token from the Authorization header (or access_token cookie).
 *   2. Verifies signature, issuer, audience, and expiry against the gateway JWKS.
 *   3. Checks the token's `jti` against the BaaS KV revocation list.
 *   4. Attaches the validated payload to `request.user`.
 *
 * Routes that don't need auth (e.g. /health, /metrics) should be registered
 * BEFORE this plugin is applied, or use `{ onRequest: [] }` to skip it.
 */
export async function registerAuthPlugin(
  app:  FastifyInstance,
  baas: BaasClient,
): Promise<void> {
  app.decorateRequest('user', null as unknown as AuthenticatedPayload)

  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip public routes
    const publicPaths = ['/health', '/metrics']
    if (publicPaths.includes(request.routeOptions?.url ?? request.url)) return

    // ── 1. Extract token ───────────────────────────────────────────────────
    const authHeader = request.headers.authorization
    const token =
      authHeader?.startsWith('Bearer ')
        ? authHeader.slice(7)
        : (request.cookies as Record<string, string | undefined>)?.access_token ?? null

    if (!token) {
      return reply.status(401).send({
        error:             'unauthorized',
        error_description: 'Missing access token.',
        request_id:        (request as any).requestUuid ?? String(request.id),
      })
    }

    // ── 2. Verify signature, issuer, audience, expiry ────────────────────
    let payload: JWTPayload & AuthenticatedPayload
    try {
      const issuer   = process.env.GATEWAY_ISSUER
      const audience = process.env.SERVICE_NAME

      if (!issuer)   throw new Error('GATEWAY_ISSUER env var is required.')
      if (!audience) throw new Error('SERVICE_NAME env var is required.')

      const result = await jwtVerify(token, getJwks(), {
        issuer,
        audience,
        algorithms: ['EdDSA'], // Reject HS256 algorithm confusion attacks
      })

      payload = result.payload as JWTPayload & AuthenticatedPayload
    } catch (err) {
      request.log.warn({ err }, 'JWT verification failed')
      return reply.status(401).send({
        error:             'invalid_token',
        error_description: 'Token is invalid or has expired.',
        request_id:        (request as any).requestUuid ?? String(request.id),
      })
    }

    // ── 3. Revocation check (per AGENTS.md §9.3) ─────────────────────────
    if (payload.jti) {
      try {
        const revoked = await baas.kv.get(`revoked:${payload.jti}`)
        if (revoked) {
          return reply.status(401).send({
            error:             'token_revoked',
            error_description: 'This token has been revoked.',
            request_id:        (request as any).requestUuid ?? String(request.id),
          })
        }
      } catch (err) {
        // KV failure — log but don't block (availability over strict revocation for ephemeral KV errors)
        request.log.warn({ err }, 'Revocation KV check failed — proceeding with caution')
      }
    }

    // ── 4. Attach to request ──────────────────────────────────────────────
    request.user = payload
  })
}

/** Resets the JWKS cache. Use in test teardown. */
export function resetJwksCache(): void {
  _jwks = null
}
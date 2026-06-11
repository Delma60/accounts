// services/auth/src/routes/refresh.ts
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { signAccessToken, generateOpaqueToken } from '../lib/token.js'
import { writeAuditLog } from '../lib/audit.js'
import { checkRateLimit, RATE_LIMITS } from '../lib/rate-limit.js'
import { getAuthEnv } from '../lib/env.js'
import type { BaasClient } from '@spurs-baas/sdk'

const RefreshBodySchema = z.object({
  refreshToken: z.string().min(1),
})

export async function refreshRoute(app: FastifyInstance, baas: BaasClient): Promise<void> {
  app.post('/auth/refresh', async (request: FastifyRequest, reply: FastifyReply) => {
    const ip        = request.ip
    const requestId = (request as any).requestUuid ?? String(request.id)
    const env       = getAuthEnv()

    // ── Rate limit: 60 req/hour per IP ───────────────────────────────────────
    const rl = await checkRateLimit(baas, `refresh:ip:${ip}`, RATE_LIMITS.refresh)
    if (!rl.allowed) {
      reply.header('Retry-After', String(rl.retryAfter))
      return reply.status(429).send({
        error:             'rate_limit_exceeded',
        error_description: 'Too many refresh attempts.',
        request_id:        requestId,
      })
    }

    // ── Extract token — body OR httpOnly cookie ───────────────────────────────
    const parsed = RefreshBodySchema.safeParse(request.body)
    const refreshToken = parsed.success
      ? parsed.data.refreshToken
      : (request.cookies?.refresh_token ?? null)

    if (!refreshToken) {
      return reply.status(400).send({
        error:             'invalid_request',
        error_description: 'refresh_token is required.',
        request_id:        requestId,
      })
    }

    // ── Look up token in KV ───────────────────────────────────────────────────
    const kvKey = `refresh:${refreshToken}`
    let session: { userId: string; email: string } | null = null
    try {
      const raw = await baas.kv.get(kvKey)
      session   = raw ? JSON.parse(String(raw)) : null
    } catch {
      session = null
    }

    if (!session) {
      // ── Replay detection: check revoked-token tombstone ───────────────────
      let wasRevoked = false
      try {
        const tombstone = await baas.kv.get(`revoked_refresh:${refreshToken}`)
        wasRevoked = !!tombstone
      } catch { /* ignore */ }

      if (wasRevoked) {
        // Token theft signal — revoke ALL sessions for this user if we can
        // We can't know the userId here, so log and reject aggressively
        await writeAuditLog(baas, request.log, {
          event:   'auth.refresh.replay_detected',
          ip,
          requestId,
          outcome: 'failure',
          meta:    { hint: 'revoked_token_replayed' },
        })
      }

      return reply.status(401).send({
        error:             'invalid_grant',
        error_description: 'Refresh token is invalid or has expired.',
        request_id:        requestId,
      })
    }

    const { userId, email } = session

    // ── Fetch user to verify account is still active ──────────────────────────
    let user: Record<string, any> | null = null
    try {
      const { data } = await baas.db('users')
        .select('id, email, name, status')
        .filter('id', 'eq', userId)
        .limit(1)
        .execute()
      user = data?.[0] ?? null
    } catch (err) {
      request.log.error({ err }, 'DB error during refresh')
      return reply.status(503).send({ error: 'service_unavailable', request_id: requestId })
    }

    if (!user || user.status === 'suspended') {
      // Revoke the token and refuse
      await baas.kv.delete(kvKey).catch(() => {})
      return reply.status(403).send({
        error:             'account_suspended',
        error_description: 'This account has been suspended.',
        request_id:        requestId,
      })
    }

    // ── Rotate: delete old token, issue new pair ──────────────────────────────
    // Write a tombstone so replays of the old token are detectable
    await baas.kv.set(
      `revoked_refresh:${refreshToken}`,
      '1',
      { ttl: env.REFRESH_TOKEN_TTL },
    ).catch(() => {})
    await baas.kv.delete(kvKey).catch(() => {})

    const newAccessToken  = await signAccessToken({ sub: userId, email, scope: 'openid profile email' })
    const newRefreshToken = generateOpaqueToken()

    await baas.kv.set(
      `refresh:${newRefreshToken}`,
      JSON.stringify({ userId, email }),
      { ttl: env.REFRESH_TOKEN_TTL },
    )

    // Update cookies
    const cookieOpts = {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'strict' as const,
      path:     '/',
      domain:   env.COOKIE_DOMAIN,
    }
    reply.setCookie('access_token',  newAccessToken,  { ...cookieOpts, maxAge: env.ACCESS_TOKEN_TTL })
    reply.setCookie('refresh_token', newRefreshToken, { ...cookieOpts, maxAge: env.REFRESH_TOKEN_TTL })

    await writeAuditLog(baas, request.log, {
      event:   'auth.refresh.success',
      userId,
      ip,
      requestId,
      outcome: 'success',
    })

    return reply.status(200).send({
      accessToken:  newAccessToken,
      refreshToken: newRefreshToken,
      expiresIn:    env.ACCESS_TOKEN_TTL,
      tokenType:    'Bearer',
    })
  })
}
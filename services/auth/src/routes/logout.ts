// services/auth/src/routes/logout.ts
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { writeAuditLog } from '../lib/audit.js'
import { getAuthEnv } from '../lib/env.js'
import type { BaasClient } from '@spurs-baas/sdk'

const LogoutBodySchema = z.object({
  refreshToken: z.string().min(1).optional(),
})

export async function logoutRoute(app: FastifyInstance, baas: BaasClient): Promise<void> {
  app.post('/auth/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    const ip        = request.ip
    const requestId = (request as any).requestUuid ?? String(request.id)
    const env       = getAuthEnv()

    // Extract refresh token from body or cookie
    const parsed       = LogoutBodySchema.safeParse(request.body)
    const refreshToken = parsed.success && parsed.data.refreshToken
      ? parsed.data.refreshToken
      : (request.cookies?.refresh_token ?? null)

    if (refreshToken) {
      try {
        // Write tombstone so replays are detectable
        await baas.kv.set(
          `revoked_refresh:${refreshToken}`,
          '1',
          { ttl: env.REFRESH_TOKEN_TTL },
        )
        await baas.kv.delete(`refresh:${refreshToken}`)
      } catch (err) {
        request.log.warn({ err }, 'Failed to revoke refresh token during logout')
      }
    }

    // Clear cookies
    const clearOpts = {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'strict' as const,
      path:     '/',
      domain:   env.COOKIE_DOMAIN,
    }
    reply.clearCookie('access_token',  clearOpts)
    reply.clearCookie('refresh_token', clearOpts)

    // Best-effort: extract userId from token KV for audit log
    await writeAuditLog(baas, request.log, {
      event:     'auth.logout.success',
      ip,
      requestId,
      outcome:   'success',
    })

    return reply.status(200).send({ message: 'Logged out successfully.' })
  })
}
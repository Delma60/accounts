// services/auth/src/plugins/index.ts
import type { FastifyInstance } from 'fastify'
import { getAuthEnv } from '../lib/env.js'

export async function registerPlugins(app: FastifyInstance): Promise<void> {
  const env = getAuthEnv()

  // ── CORS ────────────────────────────────────────────────────────────────────
  await app.register(import('@fastify/cors'), {
    origin:      env.CORS_ALLOWED_ORIGINS.split(',').map((o) => o.trim()),
    credentials: true,
  })

  // ── Cookies (httpOnly session cookies) ────────────────────────────────────
  await app.register(import('@fastify/cookie'), {
    secret: env.COOKIE_SECRET,
    hook:   'onRequest',
  })

  // ── Request ID decoration ─────────────────────────────────────────────────
  app.addHook('onRequest', async (request) => {
    if (!request.id) {
      // Fastify auto-generates a numeric id; we want UUID for distributed tracing
      (request as any).requestUuid = crypto.randomUUID()
    }
  })

  app.log.info('Plugins registered')
}
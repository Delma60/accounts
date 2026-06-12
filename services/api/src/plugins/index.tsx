// services/api/src/plugins/index.ts
import type { FastifyInstance } from 'fastify'
import { createBaasClient } from '@app/utils'
import { registerAuthPlugin } from './auth.js'

export async function registerPlugins(app: FastifyInstance): Promise<void> {
  const corsOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())

  // ── CORS ──────────────────────────────────────────────────────────────────
  await app.register(import('@fastify/cors'), {
    origin:      corsOrigins,
    credentials: true,
  })

  // ── Cookies ───────────────────────────────────────────────────────────────
  await app.register(import('@fastify/cookie'), {
    hook: 'onRequest',
  })

  // ── Request ID (UUID for distributed tracing) ─────────────────────────────
  app.addHook('onRequest', async (request) => {
    ;(request as any).requestUuid = crypto.randomUUID()
    // Attach to response for clients to correlate
    void request.server.reply // type hint
  })

  // ── JWT auth middleware ───────────────────────────────────────────────────
  const baas = (app as any).baas
  await registerAuthPlugin(app, baas)

  app.log.info('API plugins registered')
}
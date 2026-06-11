// services/auth/src/routes/index.ts
import { FastifyInstance } from 'fastify'
import client from 'prom-client'

// Feature route controllers
import { registerRoute } from './register.js'
import { loginRoute } from './login.js'
import { refreshRoute } from './refresh.js'
import { logoutRoute } from './logout.js'
import { mfaEnrollRoute, mfaVerifyRoute, mfaActivateRoute } from './mfa.js'
import { passwordRoutes } from './password.js'
import { oauthRoutes } from './oauth.js'
// import { oidcRoutes } from './oidc.js'

// Initialize promotional metrics registry engine
const register = new client.Registry()
client.collectDefaultMetrics({ register })

export async function registerRoutes(app: FastifyInstance) {
  // Extract custom injected core BaaS Client from fastify instantiation setup context
  const baas = (app as any).baas

  // ── GET /health with live BaaS connectivity check dependency probe ──────────
  app.get('/health', async (request, reply) => {
    try {
      // Execute light execution layer probe directly over DB pool mapping
      await baas.db('users').select('id').limit(1).execute()
      return { status: 'ok', services: { database: 'healthy' } }
    } catch (err) {
      app.log.error({ err }, 'Healthcheck probe verification runtime failure')
      return reply.status(503).send({ status: 'error', reason: 'BaaS database collection layer unreachable' })
    }
  })

  // ── GET /metrics for Prometheus monitoring scraping architecture ───────────
  app.get('/metrics', async (request, reply) => {
    try {
      reply.header('Content-Type', register.contentType)
      return await register.metrics()
    } catch (err) {
      return reply.status(500).send(err)
    }
  })

  // ── Core Authentication Route bindings ─────────────────────────────────────
  await registerRoute(app, baas)
  await loginRoute(app, baas)
  await refreshRoute(app, baas)
  await logoutRoute(app, baas)
  
  // MFA subsystems
  await mfaEnrollRoute(app, baas)
  await mfaVerifyRoute(app, baas)
  await mfaActivateRoute(app, baas)

  // Newly implemented Phase 2 core engine routing subsystems
  await passwordRoutes(app, baas)
  await oauthRoutes(app, baas)
  await oidcRoutes(app, baas)
}
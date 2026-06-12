// services/api/src/routes/index.ts
import { FastifyInstance } from 'fastify'
import client from 'prom-client'
import { requireScopes } from '../plugins/authorization.js'

const register = new client.Registry()
client.collectDefaultMetrics({ register })

export async function registerRoutes(app: FastifyInstance) {
  const baas = (app as any).baas

  // ── GET /health — public, no auth ────────────────────────────────────────
  app.get('/health', async (request, reply) => {
    try {
      await baas.db('users').select('id').limit(1).execute()
      return { status: 'ok', service: 'api', baas: 'ok' }
    } catch (err) {
      app.log.error({ err }, 'Health check failed')
      return reply.status(503).send({ status: 'error', baas: 'degraded' })
    }
  })

  // ── GET /metrics — internal only ─────────────────────────────────────────
  app.get('/metrics', async (request, reply) => {
    try {
      reply.header('Content-Type', register.contentType)
      return await register.metrics()
    } catch (err) {
      return reply.status(500).send(err)
    }
  })

  // ── GET /me — authenticated user profile ─────────────────────────────────
  // Demonstrates scope enforcement. Requires 'profile' scope (standard OIDC).
  app.get(
    '/me',
    { preHandler: requireScopes('profile') },
    async (request, reply) => {
      const { sub: userId, email } = request.user

      try {
        const { data } = await baas.db('users')
          .select('id, email, name, status, created_at')
          .filter('id', 'eq', userId)
          .limit(1)
          .execute()

        const user = data?.[0]
        if (!user || user.status === 'suspended') {
          return reply.status(403).send({
            error:             'access_denied',
            error_description: 'Account is unavailable.',
            request_id:        (request as any).requestUuid ?? String(request.id),
          })
        }

        return reply.status(200).send({
          id:        user.id,
          email:     user.email,
          name:      user.name ?? null,
          status:    user.status,
          createdAt: user.created_at,
        })
      } catch (err) {
        request.log.error({ err }, 'Failed to fetch user profile')
        return reply.status(503).send({
          error:      'service_unavailable',
          request_id: (request as any).requestUuid ?? String(request.id),
        })
      }
    },
  )

  // Add further business API routes below.
  // Example:
  //   app.get('/items', { preHandler: requireScopes('openid') }, async (request) => {
  //     return baas.db('items').select('*').filter('owner_id', 'eq', request.user.sub).execute()
  //   })
}
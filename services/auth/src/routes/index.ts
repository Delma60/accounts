import { FastifyInstance } from 'fastify'

export async function registerRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({ status: 'ok' }))

  // Register auth routes here.
  // Example:
  // app.post('/auth/login', async (request, reply) => { ... })
}

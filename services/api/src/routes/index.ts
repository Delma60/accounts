import { FastifyInstance } from 'fastify'

export async function registerRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({ status: 'ok' }))

  // Add business API routes here.
  // Example: app.get('/items', async () => { return [] })
}

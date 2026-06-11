import { FastifyInstance } from 'fastify'

export async function registerPlugins(app: FastifyInstance) {
  app.register(import('@fastify/cors'), {
    origin: true,
  })

  // Register additional plugins here, such as JWT, rate limit, and logging.
}

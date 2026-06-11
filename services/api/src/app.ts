import Fastify from 'fastify'
import { registerRoutes } from './routes'

export async function buildApiApp() {
  const app = Fastify({ logger: true })

  await registerRoutes(app)

  return app
}

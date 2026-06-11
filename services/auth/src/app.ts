import Fastify from 'fastify'
import { registerPlugins } from './plugins'
import { registerRoutes } from './routes'

export async function buildAuthApp() {
  const app = Fastify({ logger: true })

  await registerPlugins(app)
  await registerRoutes(app)

  return app
}

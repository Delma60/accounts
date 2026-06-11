import Fastify from 'fastify'
import { registerPlugins } from './plugins'
import { registerRoutes } from './routes'
import { BaasClient } from '@spurs-baas/sdk';

export async function buildAuthApp(customBaas?: any) {
  const app = Fastify({ logger: true })

  ;(app as any).baas = customBaas ?? new BaasClient({
    projectId: process.env.BAAS_PROJECT_ID!,
    apiKey: process.env.BAAS_API_KEY!,
    baseUrl: process.env.BAAS_BASE_URL
  })

  await registerPlugins(app)
  await registerRoutes(app)

  return app
}

import Fastify from 'fastify'
import { registerPlugins } from './plugins'
import { registerRoutes } from './routes'
import { BaasClient } from '@spurs-baas/sdk'

export async function buildAuthApp(customBaas?: any) {
  const app = Fastify({ logger: true })

  const baas = customBaas || new BaasClient({
    projectId: process.env.BAAS_PROJECT_ID!,
    apiKey: process.env.BAAS_API_KEY!,
    baseUrl: process.env.BAAS_BASE_URL,
  })

  ;(app as any).baas = baas

  // Wake up the Spur Connect backend before accepting traffic.
  // This prevents the first real request from hitting a cold-start timeout.
  if (!customBaas) {
    const result = await baas.wakeUp({
      onAttempt: (n: number) => app.log.info(`Waking BaaS backend… attempt ${n}`),
    })
    if (!result.ok) {
      app.log.warn({ error: result.error }, 'BaaS backend cold-start taking longer than expected')
    }
  }

  await registerPlugins(app)
  await registerRoutes(app)

  return app
}
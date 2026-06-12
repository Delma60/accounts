// services/api/src/app.ts
import Fastify from 'fastify'
import { BaasClient } from '@spurs-baas/sdk'
import { registerPlugins } from './plugins/index.js'
import { registerRoutes } from './routes/index.js'

// Singleton BaaS client — mirrors createBaasClient() from @app/utils.
// Constructed directly here so the service works before packages/utils is built.
let _baasInstance: BaasClient | null = null

function getBaasClient(): BaasClient {
  if (_baasInstance) return _baasInstance
  const projectId = process.env.BAAS_PROJECT_ID
  const apiKey    = process.env.BAAS_API_KEY
  if (!projectId) throw new Error('BAAS_PROJECT_ID is required but was not set.')
  if (!apiKey)    throw new Error('BAAS_API_KEY is required but was not set.')
  _baasInstance = new BaasClient({ projectId, apiKey, baseUrl: process.env.BAAS_BASE_URL })
  return _baasInstance
}

/** Reset singleton — call in test teardown when swapping BaaS implementations. */
export function resetBaasInstance(): void { _baasInstance = null }

export async function buildApiApp(customBaas?: any) {
  const app = Fastify({ logger: true })

  // Pass customBaas in tests to inject a mock without hitting real Spur Connect.
  const baas = customBaas ?? getBaasClient()
  ;(app as any).baas = baas

  // Wake Spur Connect backend on cold start (production only)
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
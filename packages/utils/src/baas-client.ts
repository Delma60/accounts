// packages/utils/src/baas-client.ts
import { BaasClient } from '@spurs-baas/sdk'

let _instance: BaasClient | null = null

export interface BaasClientOptions {
  projectId?: string
  apiKey?: string
  baseUrl?: string
}

/**
 * Returns a singleton BaasClient for the calling service.
 *
 * Configuration is read from environment variables by default:
 *   BAAS_PROJECT_ID, BAAS_API_KEY, BAAS_BASE_URL
 *
 * Pass explicit options to override (useful in tests):
 *   createBaasClient({ projectId: 'test', apiKey: 'test' })
 */
export function createBaasClient(options: BaasClientOptions = {}): BaasClient {
  if (_instance) return _instance

  const projectId = options.projectId ?? process.env.BAAS_PROJECT_ID
  const apiKey    = options.apiKey    ?? process.env.BAAS_API_KEY
  const baseUrl   = options.baseUrl   ?? process.env.BAAS_BASE_URL

  if (!projectId) throw new Error('BAAS_PROJECT_ID is required but was not set.')
  if (!apiKey)    throw new Error('BAAS_API_KEY is required but was not set.')

  _instance = new BaasClient({ projectId, apiKey, baseUrl, timeout: 90_000 })
  return _instance
}

/**
 * Resets the singleton. Use this in test teardown to prevent state leaking
 * between tests when you swap out the BaasClient implementation via vi.mock.
 */
export function resetBaasClientSingleton(): void {
  _instance = null
}
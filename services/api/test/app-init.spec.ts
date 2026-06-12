// services/api/test/app-init.spec.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildApiApp, resetBaasInstance } from '../src/app.js'

const mockWakeUp = vi.fn().mockResolvedValue({ ok: true })

vi.mock('@spurs-baas/sdk', () => {
  return {
    BaasClient: vi.fn().mockImplementation(() => {
      return {
        wakeUp: mockWakeUp,
      }
    }),
  }
})

describe('API Server Initialization Flow Coverage', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    resetBaasInstance()
    vi.clearAllMocks()
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('throws an intentional validation error if BAAS_PROJECT_ID is omitted', async () => {
    delete process.env.BAAS_PROJECT_ID
    process.env.BAAS_API_KEY = 'mock-api-key'

    await expect(buildApiApp()).rejects.toThrow('BAAS_PROJECT_ID is required but was not set.')
  })

  it('throws an intentional validation error if BAAS_API_KEY is omitted', async () => {
    process.env.BAAS_PROJECT_ID = 'mock-project-id'
    delete process.env.BAAS_API_KEY

    await expect(buildApiApp()).rejects.toThrow('BAAS_API_KEY is required but was not set.')
  })

  it('builds smoothly using standard BaasClient instance and triggers wakeUp sequence', async () => {
    process.env.BAAS_PROJECT_ID = 'mock-project-id'
    process.env.BAAS_API_KEY = 'mock-api-key'
    mockWakeUp.mockResolvedValueOnce({ ok: true })

    const app = await buildApiApp()
    expect(app).toBeDefined()
    expect(mockWakeUp).toHaveBeenCalled()

    // Test the singleton instance caching branch in getBaasClient
    const appSecondCall = await buildApiApp()
    expect(appSecondCall).toBeDefined()
  })

  it('handles and gracefully logs warnings if wakeUp cold-start fails', async () => {
    process.env.BAAS_PROJECT_ID = 'mock-project-id'
    process.env.BAAS_API_KEY = 'mock-api-key'
    mockWakeUp.mockResolvedValueOnce({ ok: false, error: 'Cold start timeout exception' })

    const app = await buildApiApp()
    expect(app).toBeDefined()
    expect(mockWakeUp).toHaveBeenCalled()
  })
})
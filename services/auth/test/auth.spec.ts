// services/auth/test/auth.spec.ts
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'
import { buildAuthApp } from '../src/app.js'
import { loadSigningKey } from '../src/lib/token.js'

describe('Authentication Gateway Integration Tests', () => {
  let app: any
  let kvStore: Map<string, string>
  let mockDbQueryResults: any[]
  let mockInsertHook: any
  let mockUpdateHook: any

  beforeAll(async () => {
    // Core keys load cleanly from vitest.config.ts configuration block
    await loadSigningKey()
  })

  beforeEach(async () => {
    kvStore = new Map()
    mockDbQueryResults = []
    mockInsertHook = vi.fn()
    mockUpdateHook = vi.fn()

    const mockBaasClient = {
      kv: {
        get: async (key: string) => kvStore.get(key) || null,
        set: async (key: string, value: string) => { kvStore.set(key, value) },
        delete: async (key: string) => { kvStore.delete(key) },
      },
      db: () => ({
        select: () => ({
          filter: () => ({
            limit: () => ({
              execute: async () => ({ data: mockDbQueryResults })
            })
          })
        }),
        insert: async (data: any) => {
          mockInsertHook(data)
          return { id: 'mock-user-id-999', ...data }
        },
        update: async (id: string, data: any) => {
          mockUpdateHook(id, data)
          return { id, ...data }
        }
      })
    }

    app = await buildAuthApp()
    app.baas = mockBaasClient
  })

  // ── REGISTER FLOW TESTS ───────────────────────────────────────────────────
  describe('POST /auth/register', () => {
    it('should successfully register a new user account profile', async () => {
      mockDbQueryResults = [] // Empty signals no duplicate email clashes

      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: 'testuser@example.com',
          password: 'supersecurepassword123',
          name: 'Tester'
        }
      })

      expect(response.statusCode).toBe(201)
      expect(JSON.parse(response.body)).toHaveProperty('user')
    })

    it('should reject requests with existing duplicate email bindings', async () => {
      mockDbQueryResults = [{ id: 'existing-id' }]

      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: 'duplicate@example.com',
          password: 'supersecurepassword123'
        }
      })

      expect(response.statusCode).toBe(409)
    })
  })

  // ── TOKEN REFRESH ROTATION TESTS ──────────────────────────────────────────
  describe('POST /auth/refresh', () => {
    it('should execute token rotation and emit a brand new cryptographic pair', async () => {
      const activeToken = 'opaque_refresh_token_string'
      kvStore.set(`refresh:${activeToken}`, JSON.stringify({ userId: 'user-uuid-1', email: 'testuser@example.com' }))
      mockDbQueryResults = [{ id: 'user-uuid-1', status: 'active' }]

      const response = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refreshToken: activeToken }
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body).toHaveProperty('accessToken')
      expect(body).toHaveProperty('refreshToken')
    })
  })

  // ── CORE SYSTEM METRICS AND DIAGNOSTIC LIVE PROBES ────────────────────────
  describe('System Check Diagnostics Engine', () => {
    it('should report active 200 system metrics diagnostic payloads', async () => {
      const response = await app.inject({ method: 'GET', url: '/metrics' })
      expect(response.statusCode).toBe(200)
    })

    it('should return 200 verification signatures over database dependency checks', async () => {
      mockDbQueryResults = [{ id: '1' }]
      const response = await app.inject({ method: 'GET', url: '/health' })
      expect(response.statusCode).toBe(200)
    })
  })
})
// services/api/test/api.spec.ts
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'
import { exportJWK, generateKeyPair, importJWK, type KeyLike } from 'jose'
import { buildApiApp } from '../src/app.js'
import { createMockBaas } from './helpers/mock-baas.js'
import { signTestToken } from './helpers/token.js'
import { resetJwksCache } from '../src/plugins/auth.js'

// ── JWKS endpoint mock ────────────────────────────────────────────────────────
// The auth plugin calls the gateway's /.well-known/jwks.json.
// We intercept global fetch to serve our test public key instead.

let testPublicJwk: Record<string, unknown>

beforeAll(async () => {
  const b64 = process.env.TEST_JWT_PRIVATE_KEY_BASE64!
  const jwk = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'))
  // Strip private key material — only expose the public component
  const { d: _d, ...pubJwk } = jwk
  testPublicJwk = { ...pubJwk, kid: process.env.TEST_JWT_KID }

  // Stub global fetch so JWKS requests return our test key
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    if (url.includes('/.well-known/jwks.json')) {
      return new Response(JSON.stringify({ keys: [testPublicJwk] }), {
        status:  200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    // Pass through anything else (shouldn't happen in tests)
    return new Response('Not found', { status: 404 })
  })
})

beforeEach(() => {
  resetJwksCache()
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildApp(overrides: Parameters<typeof createMockBaas>[0] = {}) {
  const baas = createMockBaas(overrides)
  return { app: buildApiApp(baas), baas }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('API Service Integration Tests', () => {

  // ── Public routes ────────────────────────────────────────────────────────
  describe('GET /health', () => {
    it('returns 200 with baas: ok when database is reachable', async () => {
      const { app } = buildApp({ dbRows: [{ id: '1' }] })
      const res = await (await app).inject({ method: 'GET', url: '/health' })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(body.status).toBe('ok')
      expect(body.baas).toBe('ok')
    })

    it('returns 503 when database probe throws', async () => {
      const baas = createMockBaas()
      baas._dbChain.execute.mockRejectedValue(new Error('Connection refused'))
      const app = await buildApiApp(baas)
      const res = await app.inject({ method: 'GET', url: '/health' })
      expect(res.statusCode).toBe(503)
    })
  })

  describe('GET /metrics', () => {
    it('returns 200 with Prometheus content type', async () => {
      const { app } = buildApp()
      const res = await (await app).inject({ method: 'GET', url: '/metrics' })
      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toMatch(/text\/plain/)
    })
  })

  // ── JWT Authentication ────────────────────────────────────────────────────
  describe('JWT authentication middleware', () => {
    it('returns 401 when no token is provided', async () => {
      const { app } = buildApp({ dbRows: [{ id: 'u1', email: 'a@b.com', name: 'A', status: 'active', created_at: '2024-01-01' }] })
      const res = await (await app).inject({ method: 'GET', url: '/me' })
      expect(res.statusCode).toBe(401)
      expect(JSON.parse(res.body).error).toBe('unauthorized')
    })

    it('returns 401 when token has wrong audience', async () => {
      const token = await signTestToken({ audience: 'wrong-service' })
      const { app } = buildApp()
      const res = await (await app).inject({
        method:  'GET',
        url:     '/me',
        headers: { authorization: `Bearer ${token}` },
      })
      expect(res.statusCode).toBe(401)
      expect(JSON.parse(res.body).error).toBe('invalid_token')
    })

    it('returns 401 when token is expired', async () => {
      const token = await signTestToken({ expiresIn: '-1s' })
      const { app } = buildApp()
      const res = await (await app).inject({
        method:  'GET',
        url:     '/me',
        headers: { authorization: `Bearer ${token}` },
      })
      expect(res.statusCode).toBe(401)
    })

    it('returns 401 when token jti is on the revocation list', async () => {
      const jti      = 'revoked-jti-abc123'
      const kvStore  = new Map([[ `revoked:${jti}`, '1' ]])
      const token    = await signTestToken({ jti })
      const { app }  = buildApp({ kvStore, dbRows: [] })

      const res = await (await app).inject({
        method:  'GET',
        url:     '/me',
        headers: { authorization: `Bearer ${token}` },
      })
      expect(res.statusCode).toBe(401)
      expect(JSON.parse(res.body).error).toBe('token_revoked')
    })

    it('accepts a valid Bearer token', async () => {
      const token = await signTestToken()
      const { app } = buildApp({
        dbRows: [{ id: 'test-user-uuid-001', email: 'test@example.com', name: 'Test', status: 'active', created_at: '2024-01-01' }],
      })
      const res = await (await app).inject({
        method:  'GET',
        url:     '/me',
        headers: { authorization: `Bearer ${token}` },
      })
      expect(res.statusCode).toBe(200)
    })
  })

  // ── GET /me ───────────────────────────────────────────────────────────────
  describe('GET /me', () => {
    it('returns the authenticated user profile', async () => {
      const token = await signTestToken({ sub: 'user-001', email: 'alice@example.com' })
      const { app } = buildApp({
        dbRows: [{ id: 'user-001', email: 'alice@example.com', name: 'Alice', status: 'active', created_at: '2024-01-01T00:00:00Z' }],
      })

      const res = await (await app).inject({
        method:  'GET',
        url:     '/me',
        headers: { authorization: `Bearer ${token}` },
      })

      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(body.id).toBe('user-001')
      expect(body.email).toBe('alice@example.com')
      expect(body.status).toBe('active')
    })

    it('returns 403 when the account is suspended', async () => {
      const token = await signTestToken({ sub: 'user-suspended' })
      const { app } = buildApp({
        dbRows: [{ id: 'user-suspended', email: 'bad@example.com', status: 'suspended' }],
      })

      const res = await (await app).inject({
        method:  'GET',
        url:     '/me',
        headers: { authorization: `Bearer ${token}` },
      })
      expect(res.statusCode).toBe(403)
      expect(JSON.parse(res.body).error).toBe('access_denied')
    })

    it('returns 503 when the database throws', async () => {
      const token = await signTestToken()
      const baas  = createMockBaas()
      baas._dbChain.execute.mockRejectedValueOnce(new Error('DB error'))
      // First call (health probe in plugin init might not run) — set up second call to fail
      baas._dbChain.execute
        .mockResolvedValueOnce({ data: [{ id: '1' }] }) // health OK
        .mockRejectedValueOnce(new Error('DB error'))    // /me query fails

      const app = await buildApiApp(baas)
      const res = await app.inject({
        method:  'GET',
        url:     '/me',
        headers: { authorization: `Bearer ${token}` },
      })
      expect(res.statusCode).toBe(503)
    })
  })

  // ── Scope enforcement ─────────────────────────────────────────────────────
  describe('Scope enforcement', () => {
    it('returns 403 when token lacks required scope', async () => {
      // Token with only 'openid' scope — /me requires 'profile'
      const token = await signTestToken({ scope: 'openid email' })
      const { app } = buildApp()

      const res = await (await app).inject({
        method:  'GET',
        url:     '/me',
        headers: { authorization: `Bearer ${token}` },
      })
      expect(res.statusCode).toBe(403)
      expect(JSON.parse(res.body).error).toBe('insufficient_scope')
    })

    it('returns 200 when token has all required scopes', async () => {
      const token = await signTestToken({ scope: 'openid profile email' })
      const { app } = buildApp({
        dbRows: [{ id: 'test-user-uuid-001', email: 'test@example.com', name: 'T', status: 'active', created_at: '2024-01-01' }],
      })

      const res = await (await app).inject({
        method:  'GET',
        url:     '/me',
        headers: { authorization: `Bearer ${token}` },
      })
      expect(res.statusCode).toBe(200)
    })
  })

})
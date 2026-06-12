// services/auth/test/auth.spec.ts
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'
import { buildAuthApp } from '../src/app.js'
import { loadSigningKey } from '../src/lib/token.js'


// Add these mock definitions right under your vitest imports:
vi.mock('../src/lib/password.js', () => ({
  verifyPassword: vi.fn(async (hash, plain) => plain === 'supersecurepassword123'),
  hashPassword: vi.fn(async (plain) => 'hashed_' + plain)
}))

vi.mock('../src/lib/mfa.js', () => ({
  generateTotpSecret: vi.fn(() => ({ secret: 'mock-secret', otpauthUrl: 'mock-url' })),
  verifyTotpCode: vi.fn(() => true),
  generateBackupCodes: vi.fn(() => ['111111', '222222'])
}))


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

    const mockDbChain: any = {
      select: () => mockDbChain,
      filter: () => mockDbChain,
      limit: () => mockDbChain,
      execute: async () => ({ data: mockDbQueryResults }),
      insert: async (data: any) => {
        mockInsertHook(data)
        return { id: 'mock-user-id-999', ...data }
      },
      update: async (id: string, data: any) => {
        mockUpdateHook(id, data)
        return { id, ...data }
      }
    }

    const mockBaasClient = {
      kv: {
        get: async (key: string) => kvStore.get(key) || null,
        set: async (key: string, value: string) => { kvStore.set(key, value) },
        delete: async (key: string) => { kvStore.delete(key) },
      },
      db: () => mockDbChain
    }

    app = await buildAuthApp(mockBaasClient)
    // app.baas = mockBaasClient
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

  // ── LOGIN & LOGOUT FLOW TESTS ─────────────────────────────────────────────
  describe('POST /auth/login & POST /auth/logout', () => {
    it('should successfully authenticate user with valid credentials', async () => {
      // Seed an active user query result (simulate hashed password validation match)
      mockDbQueryResults = [{ 
        id: 'user-uuid-1', 
        email: 'testuser@example.com', 
        password_hash: 'hashed_password_placeholder', // matches mock validation
        status: 'active',
        mfa_enabled: false
      }]

      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'testuser@example.com', password: 'supersecurepassword123' }
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body).toHaveProperty('accessToken')
      expect(body).toHaveProperty('refreshToken')
    })

    it('should return 401 given invalid credentials or missing user profile', async () => {
      mockDbQueryResults = [] // No user found

      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'missing@example.com', password: 'wrongpassword' }
      })

      expect(response.statusCode).toBe(401)
    })

    it('should return 202 challenge when user has MFA enabled', async () => {
      mockDbQueryResults = [{ 
        id: 'user-uuid-1', 
        email: 'mfauser@example.com', 
        status: 'active',
        mfa_enabled: true,
        mfa_secret: 'JBSWY3DPEHPK3PXP'
      }]

      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'mfauser@example.com', password: 'supersecurepassword123' }
      })

      expect(response.statusCode).toBe(202)
      expect(JSON.parse(response.body)).toHaveProperty('challengeId')
    })

    it('should cleanly invalidate active tokens on logout', async () => {
      const activeToken = 'token_to_be_revoked'
      
      const response = await app.inject({
        method: 'POST',
        url: '/auth/logout',
        payload: { refreshToken: activeToken }
      })

      expect(response.statusCode).toBe(200)
      // Check that token got tombstoned inside the mock key-value storage layer
      expect(kvStore.get(`revoked_refresh:${activeToken}`)).toBe('1')
    })
  })

  // ── MFA SUBSYSTEM VALIDATION TESTS ─────────────────────────────────────────
  describe('MFA Lifecycle Endpoints', () => {
    const mockPayload = Buffer.from(JSON.stringify({ sub: 'user-uuid-1', email: 'tester@example.com' })).toString('base64url')
    const mockToken = `header.${mockPayload}.signature`
    it('should issue a valid setup secret during enrollment requests', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/mfa/enroll',
        headers: { authorization: 'Bearer mock-valid-session-token' } // contextual auth simulation
      })
      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body).toHaveProperty('secret')
      expect(body).toHaveProperty('otpauthUrl')
    })

    it('should activate MFA when verifying a valid verification handshake token', async () => {
      mockDbQueryResults = [{ id: 'user-uuid-1', email: 'tester@example.com' }]
      
      const response = await app.inject({
        method: 'POST',
        url: '/auth/mfa/activate',
        headers: { authorization: `Bearer ${mockToken}` }, // Fix: Supply token header contextual auth
        payload: { code: '123456' }
      })
      
      expect(response.statusCode).toBe(200)
      expect(mockUpdateHook).toHaveBeenCalledWith('user-uuid-1', expect.objectContaining({ mfa_enabled: true }))
    })
  })

  // ── PASSWORD RESET MANAGEMENT FLOWS ────────────────────────────────────────
  describe('Password Reset Engine', () => {
    it('should process forgot password requests and generate an expiration ticket token', async () => {
      mockDbQueryResults = [{ id: 'user-uuid-1', email: 'testuser@example.com' }]

      const response = await app.inject({
        method: 'POST',
        url: '/auth/password/forgot',
        payload: { email: 'testuser@example.com' }
      })

      expect(response.statusCode).toBe(200)
    })

    it('should verify reset tokens and apply credentials updates securely', async () => {
      const activeResetToken = 'crypto_reset_token_uuid'
      kvStore.set(`reset_token:${activeResetToken}`, 'user-uuid-1')
      mockDbQueryResults = [{ id: 'user-uuid-1', email: 'testuser@example.com' }]

      const response = await app.inject({
        method: 'POST',
        url: '/auth/password/reset',
        payload: { token: activeResetToken, password: 'BrandNewSecurePassword999!' }
      })

      expect(response.statusCode).toBe(200)
      expect(mockUpdateHook).toHaveBeenCalled()
    })
  })

  // ── OAUTH2 & OIDC PROTOCOL ENGINE VALIDATION ───────────────────────────────
  describe('OAuth 2.0 / OIDC Protocol Handlers', () => {
    it('should successfully exchange a valid authorization_code for core token sets', async () => {
      const activeAuthCode = 'valid_code_grant_token'
      kvStore.set(`auth_code:${activeAuthCode}`, JSON.stringify({
        userId: 'user-uuid-1',
        email: 'testuser@example.com',
        client_id: 'accounts-ui',
        redirect_uri: 'http://localhost:3000/callback',
        code_challenge: 'valid_pkce_challenge_string',
        scope: 'openid profile'
      }))
      mockDbQueryResults = [{ id: 'user-uuid-1', status: 'active' }]

      const response = await app.inject({
        method: 'POST',
        url: '/auth/oauth/token',
        payload: {
          grant_type: 'authorization_code',
          client_id: 'accounts-ui',
          redirect_uri: 'http://localhost:3000/callback',
          code: activeAuthCode,
          code_verifier: 'valid_pkce_challenge_string' // match verification code
        }
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body).toHaveProperty('access_token')
      expect(body).toHaveProperty('id_token')
    })

    it('should serve OIDC standard OpenID Discovery Metadata configurations', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/.well-known/openid-configuration'
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.issuer).toBeDefined()
      expect(body.authorization_endpoint).toBeDefined()
    })

    it('should publish JWKS endpoint exposing cryptographic validation public keys', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/.well-known/jwks.json'
      })

      expect(response.statusCode).toBe(200)
      expect(JSON.parse(response.body)).toHaveProperty('keys')
    })
  })


})
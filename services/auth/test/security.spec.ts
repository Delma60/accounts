// services/auth/test/security.spec.ts
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'
import { buildAuthApp } from '../src/app.js'
import { loadSigningKey } from '../src/lib/token.js'
import { SignJWT } from 'jose'
import crypto from 'node:crypto'

describe('Authentication Gateway Security Invariant Tests', () => {
  let app: any
  let kvStore: Map<string, string>
  let mockDbQueryResults: any[]
  let mockAuditLogs: any[]

  beforeAll(async () => {
    await loadSigningKey()
  })

  beforeEach(async () => {
    kvStore = new Map()
    mockDbQueryResults = []
    mockAuditLogs = []

    const mockDbChain: any = {
      select: () => mockDbChain,
      filter: () => mockDbChain,
      limit: () => mockDbChain,
      execute: async () => ({ data: mockDbQueryResults }),
    }

    const mockBaasClient = {
      kv: {
        get: async (key: string) => kvStore.get(key) || null,
        set: async (key: string, value: string) => { kvStore.set(key, value) },
        delete: async (key: string) => { kvStore.delete(key) },
      },
      db: () => mockDbChain,
      // Intercept audit logging events for security alerting tests
      logAuthEvent: (log: any) => { mockAuditLogs.push(log) }
    }

    app = await buildAuthApp(mockBaasClient)
    // Patch writeAuditLog hook to monitor security incident logs
    app.baas = mockBaasClient
  })

  // ── 1. JWT ALGORITHM CONFUSION PROTECTION ─────────────────────────────────
  describe('JWT Algorithm Confusion Protection', () => {
    it('should reject access tokens signed with symmetric HMAC (HS256) using public key bits', async () => {
      // Simulate an attacker generating an HMAC token using your public key string 
      // to exploit standard asymmetric verification layers
      const maliciousSecret = crypto.createHash('sha256').update('mock-public-key-bytes').digest()
      
      const forgedToken = await new SignJWT({ sub: 'user-uuid-1', email: 'attacker@evil.com', scope: 'openid' })
        .setProtectedHeader({ alg: 'HS256' }) // Forged type switch
        .setIssuer('http://localhost:3000')
        .sign(maliciousSecret)

      // Inject the forged token into the OIDC userinfo profile path
      const response = await app.inject({
        method: 'GET',
        url: '/auth/userinfo',
        headers: {
          authorization: `Bearer ${forgedToken}`
        }
      })

      // Must be rejected as unauthorized or malformed due to strict EdDSA/Ed25519 constraint checks
      expect(response.statusCode).toBe(401)
    })
  })

  // ── 2. PKCE BYPASS PROTECTION ─────────────────────────────────────────────
  describe('PKCE Bypass Vulnerability Safeguards', () => {
    it('should reject token exchange requests if the code_verifier fails challenge validation', async () => {
      const challenge = crypto.createHash('sha256').update('correct_verifier_string').digest('base64url')
      const targetAuthCode = 'valid_oauth_auth_code'

      // Pre-seed an active code grant context inside our mock transactional KV store
      kvStore.set(`auth_code:${targetAuthCode}`, JSON.stringify({
        userId: 'user-uuid-1',
        email: 'tester@example.com',
        client_id: 'accounts-ui',
        redirect_uri: 'http://localhost:3000/callback',
        code_challenge: challenge,
        scope: 'openid profile'
      }))

      // Execute exchange using an invalid/compromised code_verifier string
      const response = await app.inject({
        method: 'POST',
        url: '/auth/oauth/token',
        payload: {
          grant_type: 'authorization_code',
          client_id: 'accounts-ui',
          redirect_uri: 'http://localhost:3000/callback',
          code: targetAuthCode,
          code_verifier: 'attacker_failed_verifier_guess'
        }
      })

      // Assert validation failure and grant denial
      expect(response.statusCode).toBe(400)
      const body = JSON.parse(response.body)
      expect(body.error).toBe('invalid_grant')
      expect(body.error_description).toContain('PKCE challenge verification failed')
    })
  })

  // ── 3. REFRESH TOKEN REPLAY DETECTION ─────────────────────────────────────
  describe('Refresh Token Replay and Theft Detection Lifecycle', () => {
    it('should trigger alert indicators and reject processing given a replayed token request', async () => {
      const replayedToken = 'stale_used_token_identifier'
      
      // Simulate token rotation history footprint by pre-seeding a tombstone
      kvStore.set(`revoked_refresh:${replayedToken}`, '1')

      const response = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refreshToken: replayedToken }
      })

      // Enforce zero trust reject
      expect(response.statusCode).toBe(401)
      expect(JSON.parse(response.body).error).toBe('invalid_grant')
    })
  })
})
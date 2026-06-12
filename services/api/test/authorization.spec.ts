// services/api/test/authorization.spec.ts
import { describe, it, expect, vi } from 'vitest'
import {
  parseScopes,
  hasScopes,
  requireScopes,
  requireOwnerOrScope,
  assertScopes,
} from '../src/plugins/authorization.js'
import type { AuthenticatedPayload } from '../src/plugins/auth.js'

function makeUser(scope: string, sub = 'user-123'): AuthenticatedPayload {
  return { sub, email: 'test@example.com', scope, jti: 'jti-001', iss: 'http://localhost:3000', aud: 'api-service', iat: 0, exp: 9999999999 }
}

function makeRequest(user: AuthenticatedPayload | null, params: Record<string, string> = {}): any {
  return { user, params, id: 'req-1', requestUuid: 'uuid-1' }
}

function makeReply(): any {
  const reply: any = { _status: 200, _body: null }
  reply.status = vi.fn((code: number) => { reply._status = code; return reply })
  reply.send   = vi.fn((body: any)   => { reply._body   = body;   return reply })
  return reply
}

describe('Authorization utilities', () => {

  describe('parseScopes', () => {
    it('parses a space-delimited scope string into a Set', () => {
      const scopes = parseScopes('openid profile email')
      expect(scopes).toEqual(new Set(['openid', 'profile', 'email']))
    })

    it('handles an empty string', () => {
      expect(parseScopes('')).toEqual(new Set())
    })

    it('handles extra whitespace', () => {
      expect(parseScopes('  openid  ')).toContain('openid')
    })
  })

  describe('hasScopes', () => {
    it('returns true when user has all required scopes', () => {
      const user = makeUser('openid profile email')
      expect(hasScopes(user, 'openid', 'profile')).toBe(true)
    })

    it('returns false when user is missing a scope', () => {
      const user = makeUser('openid email')
      expect(hasScopes(user, 'openid', 'profile')).toBe(false)
    })

    it('returns true with no required scopes (vacuously true)', () => {
      expect(hasScopes(makeUser('openid'))).toBe(true)
    })
  })

  describe('requireScopes', () => {
    it('calls next when user has required scopes', async () => {
      const guard   = requireScopes('openid', 'profile')
      const request = makeRequest(makeUser('openid profile email'))
      const reply   = makeReply()

      await guard(request, reply)
      expect(reply.status).not.toHaveBeenCalled()
    })

    it('returns 403 when user lacks a scope', async () => {
      const guard   = requireScopes('admin:read')
      const request = makeRequest(makeUser('openid profile'))
      const reply   = makeReply()

      await guard(request, reply)
      expect(reply.status).toHaveBeenCalledWith(403)
      expect(reply._body.error).toBe('insufficient_scope')
    })

    it('returns 401 when request has no user (unauthenticated)', async () => {
      const guard   = requireScopes('openid')
      const request = makeRequest(null)
      const reply   = makeReply()

      await guard(request, reply)
      expect(reply.status).toHaveBeenCalledWith(401)
    })
  })

  describe('requireOwnerOrScope', () => {
    it('allows owner to access their own resource', async () => {
      const guard   = requireOwnerOrScope('userId', 'admin:read')
      const request = makeRequest(makeUser('openid', 'owner-sub-123'), { userId: 'owner-sub-123' })
      const reply   = makeReply()

      await guard(request, reply)
      expect(reply.status).not.toHaveBeenCalled()
    })

    it('allows admin (with admin scope) to access any resource', async () => {
      const guard   = requireOwnerOrScope('userId', 'admin:read')
      const request = makeRequest(makeUser('openid admin:read', 'admin-sub'), { userId: 'other-sub' })
      const reply   = makeReply()

      await guard(request, reply)
      expect(reply.status).not.toHaveBeenCalled()
    })

    it('returns 403 when neither owner nor admin', async () => {
      const guard   = requireOwnerOrScope('userId', 'admin:read')
      const request = makeRequest(makeUser('openid profile', 'user-a'), { userId: 'user-b' })
      const reply   = makeReply()

      await guard(request, reply)
      expect(reply.status).toHaveBeenCalledWith(403)
    })
  })

  describe('assertScopes', () => {
    it('returns true and does not call reply when scopes match', () => {
      const request = makeRequest(makeUser('openid profile'))
      const reply   = makeReply()
      const result  = assertScopes(request, reply, 'openid')
      expect(result).toBe(true)
      expect(reply.send).not.toHaveBeenCalled()
    })

    it('returns false and sends 403 when scopes are missing', () => {
      const request = makeRequest(makeUser('openid'))
      const reply   = makeReply()
      const result  = assertScopes(request, reply, 'admin:write')
      expect(result).toBe(false)
      expect(reply.status).toHaveBeenCalledWith(403)
    })
  })
})
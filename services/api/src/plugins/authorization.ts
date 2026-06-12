// services/api/src/plugins/authorization.ts
//
// Per AGENTS.md §7.2:
//   Downstream services enforce authorisation based on token scopes and user roles.
//   Never implement login flows here — only check what the gateway already issued.

import type { FastifyRequest, FastifyReply } from 'fastify'
import type { AuthenticatedPayload } from './auth.js'

// ── Scope helpers ─────────────────────────────────────────────────────────────

/**
 * Parses the space-delimited scope string from the access token into a Set.
 */
export function parseScopes(scopeString: string): Set<string> {
  return new Set(scopeString.split(' ').filter(Boolean))
}

/**
 * Returns true if the token's scope string contains ALL of the required scopes.
 */
export function hasScopes(user: AuthenticatedPayload, ...required: string[]): boolean {
  const scopes = parseScopes(user.scope)
  return required.every((s) => scopes.has(s))
}

// ── Route-level guards ────────────────────────────────────────────────────────

/**
 * Fastify preHandler factory: requires the authenticated user to hold all
 * specified scopes. Returns 403 if any are missing.
 *
 * Usage:
 *   app.get('/admin/users', { preHandler: requireScopes('admin:read') }, handler)
 */
export function requireScopes(...scopes: string[]) {
  return async function scopeGuard(
    request: FastifyRequest,
    reply:   FastifyReply,
  ): Promise<void> {
    const user = request.user
    if (!user) {
      return reply.status(401).send({
        error:             'unauthorized',
        error_description: 'Authentication required.',
        request_id:        (request as any).requestUuid ?? String(request.id),
      })
    }

    if (!hasScopes(user, ...scopes)) {
      // Log denial via request.log if available (not present in unit test mocks)
      request.log?.warn?.(
        { userId: user.sub, required: scopes, actual: user.scope },
        'Insufficient scope — access denied',
      )
      return reply.status(403).send({
        error:             'insufficient_scope',
        error_description: `Required scope(s): ${scopes.join(', ')}`,
        request_id:        (request as any).requestUuid ?? String(request.id),
      })
    }
  }
}

/**
 * Fastify preHandler factory: requires the authenticated user to be the owner
 * of a resource identified by a route param, OR to hold an admin scope.
 *
 * Usage:
 *   app.get('/users/:userId/profile', { preHandler: requireOwnerOrScope('userId', 'admin:read') }, handler)
 */
export function requireOwnerOrScope(paramName: string, adminScope: string) {
  return async function ownerGuard(
    request: FastifyRequest,
    reply:   FastifyReply,
  ): Promise<void> {
    const user = request.user
    if (!user) {
      return reply.status(401).send({
        error:             'unauthorized',
        error_description: 'Authentication required.',
        request_id:        (request as any).requestUuid ?? String(request.id),
      })
    }

    const resourceOwnerId = (request.params as Record<string, string>)[paramName]
    const isOwner         = user.sub === resourceOwnerId
    const isAdmin         = hasScopes(user, adminScope)

    if (!isOwner && !isAdmin) {
      return reply.status(403).send({
        error:             'access_denied',
        error_description: 'You do not have permission to access this resource.',
        request_id:        (request as any).requestUuid ?? String(request.id),
      })
    }
  }
}

/**
 * Inline scope check for use inside handler bodies when route-level guards
 * are too coarse-grained.
 *
 * Usage:
 *   if (!assertScopes(request, reply, 'profile')) return
 */
export function assertScopes(
  request: FastifyRequest,
  reply:   FastifyReply,
  ...scopes: string[]
): boolean {
  if (!request.user || !hasScopes(request.user, ...scopes)) {
    reply.status(403).send({
      error:             'insufficient_scope',
      error_description: `Required scope(s): ${scopes.join(', ')}`,
      request_id:        (request as any).requestUuid ?? String(request.id),
    })
    return false
  }
  return true
}
// services/auth/src/routes/oauth.ts
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import crypto from 'node:crypto'
import { signAccessToken, signIdToken, generateOpaqueToken, getPublicJwk, verifyAccessToken } from '../lib/token.js'
import { getAuthEnv } from '../lib/env.js'
import type { BaasClient } from '@spurs-baas/sdk'
import { writeAuditLog } from '../lib/audit.js'


export async function oidcRoutes(app: FastifyInstance, baas: BaasClient): Promise<void> {
  const env = getAuthEnv()

  // GET /.well-known/jwks.json
  app.get('/.well-known/jwks.json', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const publicJwk = getPublicJwk()
      return reply.status(200).send({ keys: [publicJwk] })
    } catch (err) {
      request.log.error({ err }, 'Failed to construct JWKS payload signature map')
      return reply.status(500).send({ error: 'internal_error' })
    }
  })

  // GET /.well-known/openid-configuration
  app.get('/.well-known/openid-configuration', async (request: FastifyRequest, reply: FastifyReply) => {
    const baseUrl = env.GATEWAY_ISSUER
    return reply.status(200).send({
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/auth/oauth/authorize`,
      token_endpoint: `${baseUrl}/auth/oauth/token`,
      userinfo_endpoint: `${baseUrl}/auth/userinfo`,
      jwks_uri: `${baseUrl}/.well-known/jwks.json`,
      scopes_supported: ['openid', 'profile', 'email'],
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['EdDSA'],
      claims_supported: ['sub', 'iss', 'aud', 'exp', 'iat', 'email', 'name'],
    })
  })

  // GET /auth/userinfo
  app.get('/auth/userinfo', async (request: FastifyRequest, reply: FastifyReply) => {
    const requestId = (request as any).requestUuid ?? String(request.id)
    const authHeader = request.headers.authorization as string | undefined
    const accessToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : request.cookies?.access_token ?? null

    if (!accessToken) {
      return reply.status(401).send({ error: 'unauthorized', error_description: 'Missing access credentials.' })
    }
    let payload: any
    
    try {
      // Isolate token verification to correctly return a 401 on validation errors
      payload = await verifyAccessToken(accessToken)
    } catch (err) {
      request.log.error({ err }, 'Access token verification failed')
      return reply.status(401).send({ 
        error: 'invalid_token', 
        error_description: 'Invalid or expired access token.' 
      })
    }

    try {
      const userId = payload.sub

      if (!userId) {
        return reply.status(401).send({ error: 'invalid_token', error_description: 'Invalid token mapping identity.' })
      }

      const { data } = await baas.db('users')
        .select('id, email, name, status')
        .filter('id', 'eq', userId)
        .limit(1)
        .execute()
      
      const user = data?.[0]

      if (!user || user.status === 'suspended') {
        return reply.status(403).send({ error: 'access_denied', error_description: 'Account profile unavailable.' })
      }

      return reply.status(200).send({
        sub: user.id,
        email: user.email,
        name: user.name ?? null,
        email_verified: user.status === 'active' || user.status !== 'pending_verification',
      })
    } catch (err) {
      request.log.error({ err }, 'Failed processing user profile query information payload')
      return reply.status(500).send({ error: 'internal_error', request_id: requestId })
    }
  })
}

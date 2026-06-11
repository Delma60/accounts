// services/auth/src/routes/oauth.ts
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import crypto from 'node:crypto'
import { signAccessToken, signIdToken, generateOpaqueToken } from '../lib/token.js'
import type { BaasClient } from '@spurs-baas/sdk'
import { writeAuditLog } from '../lib/audit.js'
import { getAuthEnv } from '../lib/env.js'

const AuthorizeQuerySchema = z.object({
  response_type: z.literal('code'),
  client_id: z.string().min(1),
  redirect_uri: z.string().url(),
  code_challenge: z.string().min(1),
  code_challenge_method: z.literal('S256'),
  state: z.string().optional(),
  scope: z.string().optional(),
})

const TokenBodySchema = z.object({
  grant_type: z.literal('authorization_code'),
  client_id: z.string().min(1),
  redirect_uri: z.string().url(),
  code: z.string().min(1),
  code_verifier: z.string().min(1),
})

function verifyCodeChallenge(verifier: string, challenge: string): boolean {
  const hash = crypto.createHash('sha256').update(verifier).digest('base64url')
  return hash === challenge
}

export async function oauthRoutes(app: FastifyInstance, baas: BaasClient): Promise<void> {
  // GET /auth/oauth/authorize
  app.get('/auth/oauth/authorize', async (request: FastifyRequest, reply: FastifyReply) => {
    const ip = request.ip
    const requestId = (request as any).requestUuid ?? String(request.id)

    const parsed = AuthorizeQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'invalid_request',
        error_description: parsed.error.issues.map((i) => i.message).join('; '),
        request_id: requestId,
      })
    }

    const { client_id, redirect_uri, code_challenge, state, scope } = parsed.data

    // Extract access token cookie from session verification layer
    const authHeader = request.headers.authorization as string | undefined
    const accessToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : request.cookies?.access_token ?? null

    if (!accessToken) {
      return reply.status(401).send({
        error: 'unauthorized',
        error_description: 'User authentication required. Redirect to login page.',
        request_id: requestId,
      })
    }

    let userId: string
    let email: string
    try {
      const [, payloadB64] = accessToken.split('.')
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
      userId = payload.sub
      email = payload.email
      if (!userId || !email) throw new Error()
    } catch {
      return reply.status(401).send({ error: 'invalid_token', request_id: requestId })
    }

    const code = crypto.randomBytes(24).toString('hex')

    // Bind transaction authorization code mapping with 5 minutes TTL
    await baas.kv.set(`auth_code:${code}`, JSON.stringify({
      userId,
      email,
      client_id,
      redirect_uri,
      code_challenge,
      scope: scope ?? 'openid profile email'
    }), { ttl: 300 })

    await writeAuditLog(baas, request.log, {
      event: 'auth.oauth.authorize.success',
      userId,
      ip,
      requestId,
      outcome: 'success',
    })

    const redirectUrl = new URL(redirect_uri)
    redirectUrl.searchParams.set('code', code)
    if (state) redirectUrl.searchParams.set('state', state)

    return reply.redirect(redirectUrl.toString())
  })

  // POST /auth/oauth/token
  app.post('/auth/oauth/token', async (request: FastifyRequest, reply: FastifyReply) => {
    const ip = request.ip
    const requestId = (request as any).requestUuid ?? String(request.id)
    const env = getAuthEnv()

    const parsed = TokenBodySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'invalid_request',
        error_description: parsed.error.issues.map((i) => i.message).join('; '),
        request_id: requestId,
      })
    }

    const { code, code_verifier, client_id, redirect_uri } = parsed.data
    const kvKey = `auth_code:${code}`

    try {
      const raw = await baas.kv.get(kvKey)
      if (!raw) {
        return reply.status(400).send({ error: 'invalid_grant', error_description: 'Code invalid or expired.' })
      }

      const context = JSON.parse(String(raw))

      if (context.client_id !== client_id || context.redirect_uri !== redirect_uri) {
        return reply.status(400).send({ error: 'invalid_grant', error_description: 'Parameters do not match.' })
      }

      // Check PKCE Verifier match
      if (!verifyCodeChallenge(code_verifier, context.code_challenge)) {
        await writeAuditLog(baas, request.log, {
          event: 'auth.oauth.pkce_failure',
          userId: context.userId, ip, requestId, outcome: 'failure',
        })
        return reply.status(400).send({ error: 'invalid_grant', error_description: 'PKCE challenge verification failed.' })
      }

      // Evict code transaction immediately to neutralize replay vector
      await baas.kv.delete(kvKey).catch(() => {})

      const accessToken = await signAccessToken({ sub: context.userId, email: context.email, scope: context.scope })
      const idToken = await signIdToken({ sub: context.userId, email: context.email, scope: context.scope })
      const refreshToken = generateOpaqueToken()

      await baas.kv.set(`refresh:${refreshToken}`, JSON.stringify({
        userId: context.userId, email: context.email,
      }), { ttl: env.REFRESH_TOKEN_TTL })

      await writeAuditLog(baas, request.log, {
        event: 'auth.oauth.token.success',
        userId: context.userId, ip, requestId, outcome: 'success',
      })

      return reply.status(200)
        .header('Cache-Control', 'no-store')
        .header('Pragma', 'no-cache')
        .send({
          access_token: accessToken,
          id_token: idToken,
          refresh_token: refreshToken,
          expires_in: env.ACCESS_TOKEN_TTL,
          token_type: 'Bearer',
          scope: context.scope,
        })
    } catch (err) {
      request.log.error({ err }, 'OAuth token exchange processing error')
      return reply.status(500).send({ error: 'internal_error', request_id: requestId })
    }
  })
}
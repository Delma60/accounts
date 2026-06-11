// services/auth/src/routes/login.ts
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { verifyPassword } from '../lib/password.js'
import { signAccessToken, generateOpaqueToken } from '../lib/token.js'
import { writeAuditLog } from '../lib/audit.js'
import { checkRateLimit, RATE_LIMITS } from '../lib/rate-limit.js'
import { getAuthEnv } from '../lib/env.js'
import type { BaasClient } from '@spurs-baas/sdk'

const LoginBodySchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
})

function setCookies(reply: FastifyReply, accessToken: string, refreshToken: string): void {
  const env = getAuthEnv()
  const cookieOpts = {
    httpOnly:   true,
    secure:     process.env.NODE_ENV === 'production',
    sameSite:   'strict' as const,
    path:       '/',
    domain:     env.COOKIE_DOMAIN,
  }
  reply.setCookie('access_token',  accessToken,  { ...cookieOpts, maxAge: env.ACCESS_TOKEN_TTL })
  reply.setCookie('refresh_token', refreshToken, { ...cookieOpts, maxAge: env.REFRESH_TOKEN_TTL })
}

export async function loginRoute(app: FastifyInstance, baas: BaasClient): Promise<void> {
  app.post('/auth/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const ip        = request.ip
    const requestId = (request as any).requestUuid ?? String(request.id)

    // ── Rate limit: 20 req/15min per IP ──────────────────────────────────────
    const ipRl = await checkRateLimit(baas, `login:ip:${ip}`, RATE_LIMITS.login)
    if (!ipRl.allowed) {
      reply.header('Retry-After', String(ipRl.retryAfter))
      return reply.status(429).send({
        error: 'rate_limit_exceeded',
        error_description: 'Too many login attempts.',
        request_id: requestId,
      })
    }

    // ── Validate input ────────────────────────────────────────────────────────
    const parsed = LoginBodySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'invalid_request',
        error_description: 'Email and password are required.',
        request_id: requestId,
      })
    }

    const { email, password } = parsed.data

    // ── Fetch user ────────────────────────────────────────────────────────────
    let user: Record<string, any> | null = null
    try {
      const { data } = await baas.db('users')
        .select('id, email, name, password_hash, status, mfa_enabled, mfa_secret')
        .filter('email', 'eq', email.toLowerCase())
        .limit(1)
        .execute()
      user = data?.[0] ?? null
    } catch (err) {
      request.log.error({ err }, 'DB error during login')
      return reply.status(503).send({ error: 'service_unavailable', request_id: requestId })
    }

    // ── Constant-time: always verify password even if user not found ──────────
    const hashToCheck = user?.password_hash ?? '$argon2id$v=19$m=65536,t=3,p=4$dummy'
    const valid = user ? await verifyPassword(hashToCheck, password) : false

    if (!user || !valid) {
      await writeAuditLog(baas, request.log, {
        event: 'auth.login.failure', ip, requestId, outcome: 'failure',
        meta: { email },
      })
      return reply.status(401).send({
        error:             'invalid_credentials',
        error_description: 'The email or password is incorrect.',
        request_id:        requestId,
      })
    }

    // ── Account status check ──────────────────────────────────────────────────
    if (user.status === 'suspended') {
      return reply.status(403).send({
        error: 'account_suspended', error_description: 'This account has been suspended.',
        request_id: requestId,
      })
    }

    // ── Per-account rate limit: 10 req/15min ─────────────────────────────────
    const acctRl = await checkRateLimit(baas, `login:acct:${user.id}`, RATE_LIMITS.loginAccount)
    if (!acctRl.allowed) {
      reply.header('Retry-After', String(acctRl.retryAfter))
      return reply.status(429).send({ error: 'rate_limit_exceeded', request_id: requestId })
    }

    // ── MFA: issue challenge if enrolled ─────────────────────────────────────
    if (user.mfa_enabled && user.mfa_secret) {
      const challengeId = crypto.randomUUID()
      const env = getAuthEnv()

      // Store challenge for 5 minutes
      await baas.kv.set(`mfa_challenge:${challengeId}`, JSON.stringify({
        userId: user.id, email: user.email, name: user.name,
      }), { ttl: 300 })

      await writeAuditLog(baas, request.log, {
        event: 'auth.login.mfa_required', userId: String(user.id), ip, requestId,
        outcome: 'info',
      })

      return reply.status(202).send({ challengeId, type: 'totp' })
    }

    // ── Issue tokens ──────────────────────────────────────────────────────────
    const env          = getAuthEnv()
    const accessToken  = await signAccessToken({ sub: user.id, email: user.email, scope: 'openid profile email' })
    const refreshToken = generateOpaqueToken()

    await baas.kv.set(`refresh:${refreshToken}`, JSON.stringify({
      userId: user.id, email: user.email,
    }), { ttl: env.REFRESH_TOKEN_TTL })

    setCookies(reply, accessToken, refreshToken)

    await writeAuditLog(baas, request.log, {
      event: 'auth.login.success', userId: String(user.id), ip, requestId, outcome: 'success',
    })

    return reply.status(200).send({
      accessToken,
      refreshToken,
      expiresIn: env.ACCESS_TOKEN_TTL,
      tokenType: 'Bearer',
    })
  })
}
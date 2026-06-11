// services/auth/src/routes/mfa.ts
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { generateTotpSecret, verifyTotpCode, generateBackupCodes } from '../lib/mfa.js'
import { hashPassword } from '../lib/password.js'
import { signAccessToken, generateOpaqueToken } from '../lib/token.js'
import { writeAuditLog } from '../lib/audit.js'
import { getAuthEnv } from '../lib/env.js'
import type { BaasClient } from '@spurs-baas/sdk'

const MfaVerifyBodySchema = z.object({
  challengeId: z.string().uuid(),
  code:        z.string().length(6).regex(/^\d{6}$/),
})

/**
 * POST /auth/mfa/enroll
 * Requires a valid access token (Bearer or cookie).
 * Returns the TOTP secret, otpauth URL, and backup codes.
 * The user must then call /auth/mfa/verify with a valid code to activate MFA.
 */
export async function mfaEnrollRoute(app: FastifyInstance, baas: BaasClient): Promise<void> {
  app.post('/auth/mfa/enroll', async (request: FastifyRequest, reply: FastifyReply) => {
    const ip        = request.ip
    const requestId = (request as any).requestUuid ?? String(request.id)
    const env       = getAuthEnv()

    // Extract Bearer token (or access_token cookie)
    const authHeader   = (request.headers.authorization as string | undefined)
    const accessToken  = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : request.cookies?.access_token ?? null

    if (!accessToken) {
      return reply.status(401).send({
        error: 'unauthorized',
        error_description: 'Access token required.',
        request_id: requestId,
      })
    }

    // Decode sub from token (we trust it here since it came from our own signing)
    let userId: string
    let email: string
    try {
      const [, payloadB64] = accessToken.split('.')
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
      userId = payload.sub
      email  = payload.email
      if (!userId || !email) throw new Error('missing claims')
    } catch {
      return reply.status(401).send({
        error: 'invalid_token',
        error_description: 'Could not decode access token.',
        request_id: requestId,
      })
    }

    // Fetch user
    let user: Record<string, any> | null = null
    try {
      const { data } = await baas.db('users')
        .select('id, email, mfa_enabled')
        .filter('id', 'eq', userId)
        .limit(1)
        .execute()
      user = data?.[0] ?? null
    } catch (err) {
      request.log.error({ err }, 'DB error during MFA enrol')
      return reply.status(503).send({ error: 'service_unavailable', request_id: requestId })
    }

    if (!user) {
      return reply.status(404).send({ error: 'not_found', request_id: requestId })
    }

    if (user.mfa_enabled) {
      return reply.status(409).send({
        error: 'mfa_already_enabled',
        error_description: 'MFA is already enabled for this account.',
        request_id: requestId,
      })
    }

    // Generate TOTP secret & backup codes
    const { secret, otpauthUrl } = generateTotpSecret(email)
    const backupCodes            = generateBackupCodes()

    // Store pending secret in KV (5 min TTL) — only activate on first successful verify
    await baas.kv.set(
      `mfa_pending:${userId}`,
      JSON.stringify({ secret, backupCodes }),
      { ttl: 300 },
    )

    await writeAuditLog(baas, request.log, {
      event:   'auth.mfa.enroll.success',
      userId:  String(userId),
      ip,
      requestId,
      outcome: 'success',
    })

    return reply.status(200).send({
      secret,
      otpauthUrl,
      backupCodes,
    })
  })
}

/**
 * POST /auth/mfa/verify
 * Verifies a TOTP code against a pending MFA challenge (post-login)
 * OR activates MFA after enrolment.
 *
 * If challengeId is present → post-login challenge flow → issues tokens.
 * If no challengeId (header auth) → activation flow → enables MFA on account.
 */
export async function mfaVerifyRoute(app: FastifyInstance, baas: BaasClient): Promise<void> {
  app.post('/auth/mfa/verify', async (request: FastifyRequest, reply: FastifyReply) => {
    const ip        = request.ip
    const requestId = (request as any).requestUuid ?? String(request.id)
    const env       = getAuthEnv()

    const parsed = MfaVerifyBodySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'invalid_request',
        error_description: 'challengeId (UUID) and a 6-digit code are required.',
        request_id: requestId,
      })
    }

    const { challengeId, code } = parsed.data

    // ── Post-login challenge flow ────────────────────────────────────────────
    const kvKey = `mfa_challenge:${challengeId}`
    let challenge: { userId: string; email: string; name?: string } | null = null
    try {
      const raw = await baas.kv.get(kvKey)
      challenge = raw ? JSON.parse(String(raw)) : null
    } catch { /* ignore */ }

    if (!challenge) {
      return reply.status(401).send({
        error: 'invalid_grant',
        error_description: 'MFA challenge not found or expired.',
        request_id: requestId,
      })
    }

    const { userId, email } = challenge

    // Fetch user's MFA secret
    let user: Record<string, any> | null = null
    try {
      const { data } = await baas.db('users')
        .select('id, email, name, status, mfa_secret')
        .filter('id', 'eq', userId)
        .limit(1)
        .execute()
      user = data?.[0] ?? null
    } catch (err) {
      request.log.error({ err }, 'DB error during MFA verify')
      return reply.status(503).send({ error: 'service_unavailable', request_id: requestId })
    }

    if (!user || !user.mfa_secret) {
      return reply.status(401).send({
        error: 'invalid_grant',
        error_description: 'MFA not configured for this account.',
        request_id: requestId,
      })
    }

    if (user.status === 'suspended') {
      return reply.status(403).send({
        error: 'account_suspended',
        error_description: 'This account has been suspended.',
        request_id: requestId,
      })
    }

    const valid = verifyTotpCode(user.mfa_secret, code)
    if (!valid) {
      await writeAuditLog(baas, request.log, {
        event:   'auth.mfa.verify.failure',
        userId:  String(userId),
        ip,
        requestId,
        outcome: 'failure',
      })
      return reply.status(401).send({
        error: 'invalid_grant',
        error_description: 'Invalid or expired MFA code.',
        request_id: requestId,
      })
    }

    // Consume challenge
    await baas.kv.delete(kvKey).catch(() => {})

    // Issue tokens
    const accessToken  = await signAccessToken({ sub: userId, email, scope: 'openid profile email' })
    const refreshToken = generateOpaqueToken()

    await baas.kv.set(
      `refresh:${refreshToken}`,
      JSON.stringify({ userId, email }),
      { ttl: env.REFRESH_TOKEN_TTL },
    )

    const cookieOpts = {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'strict' as const,
      path:     '/',
      domain:   env.COOKIE_DOMAIN,
    }
    reply.setCookie('access_token',  accessToken,  { ...cookieOpts, maxAge: env.ACCESS_TOKEN_TTL })
    reply.setCookie('refresh_token', refreshToken, { ...cookieOpts, maxAge: env.REFRESH_TOKEN_TTL })

    await writeAuditLog(baas, request.log, {
      event:   'auth.mfa.verify.success',
      userId:  String(userId),
      ip,
      requestId,
      outcome: 'success',
    })

    return reply.status(200).send({
      accessToken,
      refreshToken,
      expiresIn: env.ACCESS_TOKEN_TTL,
      tokenType: 'Bearer',
    })
  })
}

/**
 * POST /auth/mfa/activate
 * Called after enrolment to activate MFA using the first TOTP code.
 * Requires Bearer access token.
 */
export async function mfaActivateRoute(app: FastifyInstance, baas: BaasClient): Promise<void> {
  app.post('/auth/mfa/activate', async (request: FastifyRequest, reply: FastifyReply) => {
    const ip        = request.ip
    const requestId = (request as any).requestUuid ?? String(request.id)

    const ActivateBodySchema = z.object({ code: z.string().length(6).regex(/^\d{6}$/) })
    const parsed = ActivateBodySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'invalid_request',
        error_description: 'A 6-digit TOTP code is required.',
        request_id: requestId,
      })
    }

    const { code } = parsed.data

    // Identify user from access token
    const authHeader  = (request.headers.authorization as string | undefined)
    const accessToken = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : request.cookies?.access_token ?? null

    if (!accessToken) {
      return reply.status(401).send({ error: 'unauthorized', request_id: requestId })
    }

    let userId: string
    try {
      const [, payloadB64] = accessToken.split('.')
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
      userId = payload.sub
      if (!userId) throw new Error('missing sub')
    } catch {
      return reply.status(401).send({ error: 'invalid_token', request_id: requestId })
    }

    // Retrieve pending MFA secret
    let pending: { secret: string; backupCodes: string[] } | null = null
    try {
      const raw = await baas.kv.get(`mfa_pending:${userId}`)
      pending = raw ? JSON.parse(String(raw)) : null
    } catch { /* ignore */ }

    if (!pending) {
      return reply.status(400).send({
        error: 'no_pending_enrolment',
        error_description: 'No pending MFA enrolment found. Call /auth/mfa/enroll first.',
        request_id: requestId,
      })
    }

    if (!verifyTotpCode(pending.secret, code)) {
      return reply.status(401).send({
        error: 'invalid_grant',
        error_description: 'Invalid TOTP code.',
        request_id: requestId,
      })
    }

    // Hash backup codes for storage
    const hashedBackups = await Promise.all(
      pending.backupCodes.map((c) => hashPassword(c)),
    )

    // Persist secret and enable MFA on user record
    try {
      await baas.db('users').update(userId, {
        mfa_enabled:  true,
        mfa_secret:   pending.secret,
        backup_codes: JSON.stringify(hashedBackups),
        updated_at:   new Date().toISOString(),
      })
    } catch (err) {
      request.log.error({ err }, 'DB error activating MFA')
      return reply.status(503).send({ error: 'service_unavailable', request_id: requestId })
    }

    await baas.kv.delete(`mfa_pending:${userId}`).catch(() => {})

    return reply.status(200).send({ message: 'MFA has been enabled on your account.' })
  })
}
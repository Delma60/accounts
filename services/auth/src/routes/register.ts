// services/auth/src/routes/register.ts
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { hashPassword } from '../lib/password.js'
import { writeAuditLog } from '../lib/audit.js'
import { checkRateLimit, RATE_LIMITS } from '../lib/rate-limit.js'
import type { BaasClient, InsertResult } from '@spurs-baas/sdk'

const RegisterBodySchema = z.object({
  email:    z.string().email(),
  password: z.string().min(12).max(128),
  name:     z.string().min(1).max(256).optional(),
})

export async function registerRoute(app: FastifyInstance, baas: BaasClient): Promise<void> {
  app.post('/auth/register', async (request: FastifyRequest, reply: FastifyReply) => {
    const ip        = request.ip
    const requestId = (request as any).requestUuid ?? String(request.id)

    // ── Rate limit: 5 req/hour per IP ────────────────────────────────────────
    const rl = await checkRateLimit(baas, `register:${ip}`, RATE_LIMITS.register)
    if (!rl.allowed) {
      reply.header('Retry-After', String(rl.retryAfter))
      return reply.status(429).send({
        error:             'rate_limit_exceeded',
        error_description: 'Too many registration attempts. Please try again later.',
        request_id:        requestId,
      })
    }

    // ── Validate input ────────────────────────────────────────────────────────
    const parsed = RegisterBodySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error:             'validation_error',
        error_description: parsed.error.issues.map((i) => i.message).join('; '),
        request_id:        requestId,
      })
    }

    const { email, password, name } = parsed.data

    // ── Check for existing user ───────────────────────────────────────────────
    try {
      const { data: existing } = await baas.db('users')
        .select('id')
        .filter('email', 'eq', email.toLowerCase())
        .limit(1)
        .execute()

      if (existing && existing.length > 0) {
        await writeAuditLog(baas, request.log, {
          event: 'auth.register.failure', ip, requestId,
          outcome: 'failure', meta: { reason: 'email_taken' },
        })
        return reply.status(409).send({
          error:             'email_taken',
          error_description: 'An account with this email already exists.',
          request_id:        requestId,
        })
      }
    } catch (err) {
      request.log.error({ err }, 'Failed to check for existing user')
      return reply.status(503).send({ error: 'service_unavailable', request_id: requestId })
    }

    // ── Hash password & create user ───────────────────────────────────────────
    const passwordHash = await hashPassword(password)
    const now          = new Date().toISOString()

    let user: any
    try {
      user = await baas.db('users').insert({
        email:        email.toLowerCase(),
        name:         name ?? null,
        password_hash: passwordHash,
        status:       'pending_verification',
        mfa_enabled:  false,
        created_at:   now,
        updated_at:   now,
      }) 
    } catch (err) {
      request.log.error({ err }, 'Failed to create user')
      return reply.status(500).send({ error: 'internal_error', request_id: requestId })
    }

    await writeAuditLog(baas, request.log, {
      event: 'auth.register.success', userId: String(user.id), ip, requestId,
      outcome: 'success',
    })

    return reply.status(201).send({
      user: {
        id:         user.id,
        email:      user.email,
        name:       user.name,
        status:     user.status,
        mfaEnabled: user.mfa_enabled,
        createdAt:  user.created_at,
        updatedAt:  user.updated_at,
      } ,
      message: 'Account created. Please verify your email to continue.',
    })
  })
}
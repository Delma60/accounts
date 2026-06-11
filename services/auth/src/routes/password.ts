// services/auth/src/routes/password.ts
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { hashPassword } from '../lib/password.js'
import { writeAuditLog } from '../lib/audit.js'
import { checkRateLimit, RATE_LIMITS } from '../lib/rate-limit.js'
import crypto from 'node:crypto'
import type { BaasClient } from '@spurs-baas/sdk'

const ForgotPasswordSchema = z.object({
  email: z.string().email(),
})

const ResetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(12).max(128),
})

export async function passwordRoutes(app: FastifyInstance, baas: BaasClient): Promise<void> {
  // POST /auth/password/forgot
  app.post('/auth/password/forgot', async (request: FastifyRequest, reply: FastifyReply) => {
    const ip = request.ip
    const requestId = (request as any).requestUuid ?? String(request.id)

    // Rate limit matching account creation constraints
    const rl = await checkRateLimit(baas, `password_forgot:${ip}`, RATE_LIMITS.register)
    if (!rl.allowed) {
      reply.header('Retry-After', String(rl.retryAfter))
      return reply.status(429).send({
        error: 'rate_limit_exceeded',
        error_description: 'Too many password reset requests. Please try again later.',
        request_id: requestId,
      })
    }

    const parsed = ForgotPasswordSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'validation_error',
        error_description: parsed.error.issues.map((i) => i.message).join('; '),
        request_id: requestId,
      })
    }

    const { email } = parsed.data

    try {
      const { data: users } = await baas.db('users')
        .select('id')
        .filter('email', 'eq', email.toLowerCase())
        .limit(1)
        .execute()

      if (users && users.length > 0) {
        const user = users[0]
        const resetToken = crypto.randomBytes(32).toString('hex')
        
        // Store verification tombstone for 15 minutes (900 seconds)
        await baas.kv.set(`password_reset:${resetToken}`, JSON.stringify({ userId: user.id }), { ttl: 900 })

        await writeAuditLog(baas, request.log, {
          event: 'auth.password.forgot.success',
          userId: String(user.id),
          ip,
          requestId,
          outcome: 'success',
        })

        // NOTE: In your architecture, you would here enqueue a job via BullMQ 
        // to have services/worker handle transactional SMTP out of band.
      } else {
        // Anti-user enumeration: Always return identical message structure
        await writeAuditLog(baas, request.log, {
          event: 'auth.password.forgot.nonexistent',
          ip,
          requestId,
          outcome: 'failure',
          meta: { email },
        })
      }

      return reply.status(200).send({
        message: 'If the email matches an active account, reset instructions have been sent.',
      })
    } catch (err) {
      request.log.error({ err }, 'Failed to process forgot password request')
      return reply.status(503).send({ error: 'service_unavailable', request_id: requestId })
    }
  })

  // POST /auth/password/reset
  app.post('/auth/password/reset', async (request: FastifyRequest, reply: FastifyReply) => {
    const ip = request.ip
    const requestId = (request as any).requestUuid ?? String(request.id)

    const parsed = ResetPasswordSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'validation_error',
        error_description: parsed.error.issues.map((i) => i.message).join('; '),
        request_id: requestId,
      })
    }

    const { token, password } = parsed.data
    const kvKey = `password_reset:${token}`

    try {
      const raw = await baas.kv.get(kvKey)
      if (!raw) {
        return reply.status(400).send({
          error: 'invalid_token',
          error_description: 'The password reset token is invalid or has expired.',
          request_id: requestId,
        })
      }

      const { userId } = JSON.parse(String(raw))
      const passwordHash = await hashPassword(password)
      const now = new Date().toISOString()

      await baas.db('users').update(userId, {
        password_hash: passwordHash,
        updated_at: now,
      })

      // Invalidate token immediately upon single use
      await baas.kv.delete(kvKey).catch(() => {})

      await writeAuditLog(baas, request.log, {
        event: 'auth.password.reset.success',
        userId: String(userId),
        ip,
        requestId,
        outcome: 'success',
      })

      return reply.status(200).send({
        message: 'Password has been reset successfully. You can now log in.',
      })
    } catch (err) {
      request.log.error({ err }, 'Failed to reset password')
      return reply.status(500).send({ error: 'internal_error', request_id: requestId })
    }
  })
}
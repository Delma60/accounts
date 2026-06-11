// services/auth/src/lib/audit.ts
import type { FastifyBaseLogger } from 'fastify'
import type { BaasClient } from '@spurs-baas/sdk'

export type AuthEvent =
  | 'auth.register.success'
  | 'auth.register.failure'
  | 'auth.login.success'
  | 'auth.login.failure'
  | 'auth.login.mfa_required'
  | 'auth.mfa.enroll.success'
  | 'auth.mfa.verify.success'
  | 'auth.mfa.verify.failure'
  | 'auth.logout.success'
  | 'auth.refresh.success'
  | 'auth.refresh.replay_detected'
  | 'auth.password.forgot'
  | 'auth.password.reset.success'
  | 'auth.oauth.authorize'
  | 'auth.oauth.token'
  | 'auth.sessions.revoked_all'

export interface AuditEntry {
  event:     AuthEvent
  userId?:   string
  ip:        string
  requestId: string
  outcome:   'success' | 'failure' | 'info'
  meta?:     Record<string, unknown>
}

/**
 * Write a structured log line AND persist an audit record via Spur Connect.
 * Both writes are best-effort — a BaaS failure never breaks the auth response.
 */
export async function writeAuditLog(
  baas:   BaasClient,
  logger: FastifyBaseLogger,
  entry:  AuditEntry,
): Promise<void> {
  // 1. Structured stdout log (forwarded to log aggregator)
  logger.info({
    event:     entry.event,
    userId:    entry.userId,
    ip:        entry.ip,
    requestId: entry.requestId,
    outcome:   entry.outcome,
    ...entry.meta,
  })

  // 2. Persistent audit record (queryable, 12-month retention)
  try {
    await baas.nosql('audit_logs').insertOne({
      ...entry,
      createdAt: new Date().toISOString(),
    })
  } catch (err) {
    logger.warn({ err }, 'Failed to persist audit log to BaaS')
  }
}
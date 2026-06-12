// services/api/src/lib/jobs.ts
//
// Per AGENTS.md §7.2 & §3.6:
//   The API service enqueues jobs for the worker via BullMQ (Redis-backed) or
//   via baas.functions for lightweight edge invocations.
//
// BullMQ connects directly to Redis via REDIS_URL.
// For each job type, a typed helper is exported so handlers stay clean.

import { Queue, type JobsOptions } from 'bullmq'
import type { BaasClient } from '@spurs-baas/sdk'

// ── Queue registry ────────────────────────────────────────────────────────────

type QueueName = 'email' | 'maintenance'

const _queues = new Map<QueueName, Queue>()

function getQueue(name: QueueName): Queue {
  if (_queues.has(name)) return _queues.get(name)!

  const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379'

  // Parse redis URL into ioredis connection object
  const url      = new URL(redisUrl)
  const queue    = new Queue(name, {
    connection: {
      host:     url.hostname,
      port:     Number(url.port) || 6379,
      password: url.password || undefined,
      tls:      url.protocol === 'rediss:' ? {} : undefined,
    },
  })

  _queues.set(name, queue)
  return queue
}

/** Gracefully close all queues. Call on process shutdown. */
export async function closeQueues(): Promise<void> {
  await Promise.all([..._queues.values()].map((q) => q.close()))
  _queues.clear()
}

// ── Job payload types ─────────────────────────────────────────────────────────

export interface SendEmailJobData {
  to:         string
  subject:    string
  templateId: string
  variables?: Record<string, string>
}

export interface MaintenanceJobData {
  task: 'prune_expired_sessions' | 'prune_old_audit_logs' | string
  meta?: Record<string, unknown>
}

// ── Default job options ───────────────────────────────────────────────────────

const DEFAULT_OPTS: JobsOptions = {
  attempts:      3,
  backoff:       { type: 'exponential', delay: 1000 },
  removeOnComplete: { count: 100 },
  removeOnFail:     { count: 50 },
}

// ── Job enqueueing helpers ────────────────────────────────────────────────────

/**
 * Enqueue a transactional email job.
 * The worker service (services/worker) consumes this queue and sends via Resend/Postmark.
 *
 * Falls back to baas.functions if REDIS_URL is not configured.
 */
export async function enqueueEmail(
  data:  SendEmailJobData,
  baas:  BaasClient,
  opts?: JobsOptions,
): Promise<void> {
  if (process.env.REDIS_URL) {
    const queue = getQueue('email')
    await queue.add('send-email', data, { ...DEFAULT_OPTS, ...opts })
  } else {
    // Fallback: invoke via Spur Connect edge function
    await baas.functions
      .invoke('send-email')
      .with(data)
      .call()
  }
}

/**
 * Enqueue a background maintenance task.
 */
export async function enqueueMaintenance(
  data:  MaintenanceJobData,
  opts?: JobsOptions,
): Promise<void> {
  const queue = getQueue('maintenance')
  await queue.add(data.task, data, { ...DEFAULT_OPTS, ...opts })
}

/**
 * Schedule a recurring maintenance job (cron syntax).
 * Example: scheduleRecurringMaintenance('prune_expired_sessions', '0 3 * * *')
 */
export async function scheduleRecurringMaintenance(
  task:    MaintenanceJobData['task'],
  pattern: string,
): Promise<void> {
  const queue = getQueue('maintenance')
  // Remove any existing repeatable with the same key before re-adding
  await queue.removeRepeatable(task, { pattern })
  await queue.add(task, { task }, { repeat: { pattern }, jobId: `recurring:${task}` })
}
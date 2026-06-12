// services/api/test/jobs.spec.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Queue } from 'bullmq'
import { 
  enqueueEmail, 
  enqueueMaintenance, 
  scheduleRecurringMaintenance, 
  closeQueues 
} from '../src/lib/jobs.js'
import { createMockBaas } from './helpers/mock-baas.js'

const mockQueueMethods = {
  add: vi.fn().mockResolvedValue({ id: 'mock-job-id' }),
  removeRepeatable: vi.fn().mockResolvedValue(true),
  close: vi.fn().mockResolvedValue(undefined),
}

vi.mock('bullmq', () => {
  return {
    Queue: vi.fn().mockImplementation(() => mockQueueMethods),
  }
})

describe('Jobs Library Tests', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    vi.clearAllMocks()
  })

  afterEach(async () => {
    process.env = originalEnv
    await closeQueues()
  })

  describe('enqueueEmail', () => {
    it('enqueues a job via BullMQ if REDIS_URL is present', async () => {
      process.env.REDIS_URL = 'redis://127.0.0.1:6379'
      const baas = createMockBaas() as any
      const data = { to: 'user@example.com', subject: 'Hello', templateId: 'welcome' }
      
      await enqueueEmail(data, baas)
      expect(mockQueueMethods.add).toHaveBeenCalledWith('send-email', data, expect.any(Object))
    })

    it('falls back to baas.functions if REDIS_URL is not configured', async () => {
      delete process.env.REDIS_URL
      const baas = createMockBaas() as any
      const data = { to: 'user@example.com', subject: 'Hello', templateId: 'welcome' }
      
      await enqueueEmail(data, baas)
      expect(baas.functions.invoke).toHaveBeenCalledWith('send-email')
    })
  })

  describe('enqueueMaintenance', () => {
    it('enqueues maintenance tasks into the maintenance queue', async () => {
      process.env.REDIS_URL = 'redis://127.0.0.1:6379'
      const data = { task: 'prune_expired_sessions' }
      
      await enqueueMaintenance(data)
      expect(mockQueueMethods.add).toHaveBeenCalledWith('prune_expired_sessions', data, expect.any(Object))
    })

    it('handles rediss protocol configuration safely', async () => {
      process.env.REDIS_URL = 'rediss://:auth@127.0.0.1:6379'
      await enqueueMaintenance({ task: 'tls-test' })
      expect(Queue).toHaveBeenCalled()
    })
  })

  describe('scheduleRecurringMaintenance', () => {
    it('schedules a repeatable repeatable cron task', async () => {
      process.env.REDIS_URL = 'redis://127.0.0.1:6379'
      const task = 'prune_old_audit_logs'
      const pattern = '0 3 * * *'
      
      await scheduleRecurringMaintenance(task, pattern)
      expect(mockQueueMethods.removeRepeatable).toHaveBeenCalledWith(task, { pattern })
      expect(mockQueueMethods.add).toHaveBeenCalledWith(task, { task }, expect.objectContaining({
        repeat: { pattern },
        jobId: `recurring:${task}`
      }))
    })
  })

  describe('Queue Cache Management and Teardown', () => {
    it('caches created queues instead of recreating them', async () => {
      process.env.REDIS_URL = 'redis://127.0.0.1:6379'
      await enqueueMaintenance({ task: 't1' })
      await enqueueMaintenance({ task: 't2' })
      
      // Constructor should be hit only once due to cache hit
      expect(Queue).toHaveBeenCalledTimes(1)
    })

    it('closes all registered queues on shutdown request', async () => {
      process.env.REDIS_URL = 'redis://127.0.0.1:6379'
      await enqueueMaintenance({ task: 'shutdown-test' })
      
      await closeQueues()
      expect(mockQueueMethods.close).toHaveBeenCalled()
    })
  })
})
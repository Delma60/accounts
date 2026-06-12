// services/api/test/helpers/mock-baas.ts
// Lightweight in-memory BaaS mock — no real Spur Connect calls in tests.

import { vi } from 'vitest'

export interface MockDbChain {
  select:  ReturnType<typeof vi.fn>
  filter:  ReturnType<typeof vi.fn>
  limit:   ReturnType<typeof vi.fn>
  execute: ReturnType<typeof vi.fn>
}

export function createMockBaas(overrides: {
  dbRows?:      Record<string, any>[]
  kvStore?:     Map<string, string>
} = {}) {
  const kvStore  = overrides.kvStore  ?? new Map<string, string>()
  const dbRows   = overrides.dbRows   ?? []

  const mockDbChain: MockDbChain = {
    select:  vi.fn().mockReturnThis(),
    filter:  vi.fn().mockReturnThis(),
    limit:   vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue({ data: dbRows }),
  }

  return {
    kv: {
      get:    vi.fn(async (key: string) => kvStore.get(key) ?? null),
      set:    vi.fn(async (key: string, value: string) => { kvStore.set(key, value) }),
      delete: vi.fn(async (key: string) => { kvStore.delete(key) }),
    },
    db:     vi.fn(() => mockDbChain),
    nosql:  vi.fn(() => ({
      insertOne: vi.fn().mockResolvedValue({ id: 'audit-log-id' }),
    })),
    functions: {
      invoke: vi.fn(() => ({
        with: vi.fn(() => ({
          call: vi.fn().mockResolvedValue({ ok: true }),
        })),
      })),
    },
    wakeUp: vi.fn().mockResolvedValue({ ok: true }),
    _kvStore: kvStore,
    _dbRows:  dbRows,
    _dbChain: mockDbChain,
  }
}

export type MockBaas = ReturnType<typeof createMockBaas>
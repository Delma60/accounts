// services/auth/src/lib/rate-limit.ts
import type { BaasClient } from '@spurs-baas/sdk'

export interface RateLimitConfig {
  windowSeconds: number
  maxRequests:   number
}

export const RATE_LIMITS = {
  login:         { windowSeconds: 900,  maxRequests: 20 } satisfies RateLimitConfig,
  loginAccount:  { windowSeconds: 900,  maxRequests: 10 } satisfies RateLimitConfig,
  register:      { windowSeconds: 3600, maxRequests: 5  } satisfies RateLimitConfig,
  refresh:       { windowSeconds: 3600, maxRequests: 60 } satisfies RateLimitConfig,
  passwordReset: { windowSeconds: 3600, maxRequests: 5  } satisfies RateLimitConfig,
} as const

/**
 * Check and increment a rate limit counter.
 * Returns { allowed: true } or { allowed: false, retryAfter: seconds }.
 */
export async function checkRateLimit(
  baas: BaasClient,
  key:  string,
  cfg:  RateLimitConfig,
): Promise<{ allowed: boolean; retryAfter?: number }> {
  const kvKey = `rl:${key}`

  let current: number
  try {
    const entry = await baas.kv.get(kvKey)
    current = entry ? Number(entry) : 0
  } catch {
    current = 0
  }

  if (current >= cfg.maxRequests) {
    return { allowed: false, retryAfter: cfg.windowSeconds }
  }

  await baas.kv.set(kvKey, String(current + 1), { ttl: cfg.windowSeconds })
  return { allowed: true }
}
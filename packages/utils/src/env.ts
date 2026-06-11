// packages/utils/src/env.ts
import { z } from 'zod'

/**
 * Parses and validates environment variables against a Zod schema.
 * Throws a descriptive error at startup if any required variables are missing.
 *
 * Usage:
 *   const env = parseEnv(z.object({
 *     GATEWAY_URL:    z.string().url(),
 *     SERVICE_PORT:   z.coerce.number().default(4000),
 *     BAAS_API_KEY:   z.string().min(1),
 *   }))
 */
export function parseEnv<T extends z.ZodTypeAny>(schema: T): z.infer<T> {
  const result = schema.safeParse(process.env)
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    throw new Error(`Environment variable validation failed:\n${issues}`)
  }
  return result.data
}

// ── Pre-built schema fragments services can compose ───────────────────────────

export const baasEnvSchema = z.object({
  BAAS_PROJECT_ID: z.string().min(1),
  BAAS_API_KEY:    z.string().min(1),
  BAAS_BASE_URL:   z.string().url().optional(),
})

export const gatewayClientEnvSchema = z.object({
  GATEWAY_URL:    z.string().url(),
  GATEWAY_ISSUER: z.string().url(),
  SERVICE_NAME:   z.string().min(1),
})

export const observabilityEnvSchema = z.object({
  LOG_LEVEL:  z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  LOG_PRETTY: z.enum(['true', 'false']).default('false'),
})
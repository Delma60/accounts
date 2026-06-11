// services/auth/src/lib/env.ts
import { z } from 'zod'

const schema = z.object({
  SERVICE_PORT:    z.coerce.number().default(4000),
  GATEWAY_URL:     z.string().url().default('http://localhost:4000'),
  GATEWAY_ISSUER:  z.string().url().default('http://localhost:4000'),

  JWT_PRIVATE_KEY_BASE64: z.string().min(1),
  JWT_KID:                z.string().min(1).default('key-1'),
  JWT_PREV_KID:           z.string().optional(),

  ACCESS_TOKEN_TTL:  z.coerce.number().default(900),    // 15 min
  REFRESH_TOKEN_TTL: z.coerce.number().default(2592000), // 30 days

  BAAS_PROJECT_ID: z.string().min(1),
  BAAS_API_KEY:    z.string().min(1),
  BAAS_BASE_URL:   z.string().url().optional(),

  COOKIE_SECRET: z.string().min(32),
  COOKIE_DOMAIN: z.string().optional(),

  CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),

  LOG_LEVEL:  z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  LOG_PRETTY: z.enum(['true', 'false']).default('false'),
})

export type AuthEnv = z.infer<typeof schema>

let _env: AuthEnv | null = null

export function getAuthEnv(): AuthEnv {
  if (_env) return _env
  const result = schema.safeParse(process.env)
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    throw new Error(`Auth env validation failed:\n${issues}`)
  }
  _env = result.data
  return _env
}

/** Reset for tests */
export function resetAuthEnv(): void { _env = null }
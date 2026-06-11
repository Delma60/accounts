// packages/utils/src/logger.ts
import pino, { type Logger, type LoggerOptions } from 'pino'

/**
 * Creates a pre-configured pino logger.
 *
 * - Production: structured JSON to stdout
 * - Development (LOG_PRETTY=true): human-readable via pino-pretty
 *
 * Usage:
 *   const logger = createLogger('auth-gateway')
 *   logger.info({ userId, event: 'auth.login.success' }, 'Login success')
 */
export function createLogger(serviceName: string, options: LoggerOptions = {}): Logger {
  const level    = process.env.LOG_LEVEL ?? 'info'
  const isPretty = process.env.LOG_PRETTY === 'true'

  const base: LoggerOptions = {
    level,
    base: { service: serviceName },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...options,
  }

  if (isPretty) {
    return pino({
      ...base,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, ignore: 'pid,hostname' },
      },
    })
  }

  return pino(base)
}

export type { Logger }
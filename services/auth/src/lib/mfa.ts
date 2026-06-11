// services/auth/src/lib/mfa.ts
import { authenticator } from 'otplib'
import { randomBytes } from 'node:crypto'

/**
 * Generate a new TOTP secret and the otpauth:// URI for QR rendering.
 */
export function generateTotpSecret(email: string): {
  secret:     string
  otpauthUrl: string
} {
  const secret = authenticator.generateSecret(32)
  const otpauthUrl = authenticator.keyuri(email, 'YourApp', secret)
  return { secret, otpauthUrl }
}

/**
 * Verify a 6-digit TOTP code against the stored secret.
 * Allows ±1 step window for clock drift.
 */
export function verifyTotpCode(secret: string, code: string): boolean {
  try {
    return authenticator.check(code, secret)
  } catch {
    return false
  }
}

/**
 * Generate 8 one-time backup codes (hex strings).
 * Store their hashes — not these plaintext values.
 */
export function generateBackupCodes(): string[] {
  return Array.from({ length: 8 }, () => randomBytes(5).toString('hex').toUpperCase())
}
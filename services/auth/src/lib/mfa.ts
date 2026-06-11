// services/auth/src/lib/mfa.ts
import { generateSecret, generateURI, verifySync } from 'otplib'
import { randomBytes } from 'node:crypto'


/**
 * Generates a high-entropy Base32 secret key and builds a 
 * compliant otpauth:// string for authenticator applications.
 */
export function generateTotpSecret(email: string) {
  const secret = generateSecret()
  const otpauthUrl = generateURI({ issuer: 'GatewayAuth', label: email, secret })
  return { secret, otpauthUrl }
}

/**
 * Verifies an incoming 6-digit TOTP token against the user's secret.
 * Returns a strict boolean flag.
 */
export function verifyTotpCode(secret: string, code: string): boolean {
  // v13 verifySync returns a structural verification object { valid: boolean, delta: number }
  const result = verifySync({ token: code, secret })
  return result.valid
}

/**
 * Generates emergency fallback numeric bypass codes.
 */
export function generateBackupCodes(): string[] {
  const codes: string[] = []
  for (let i = 0; i < 10; i++) {
    // Generate an 8-character numeric backup code
    const code = Array.from({ length: 8 }, () => Math.floor(Math.random() * 10)).join('')
    codes.push(code)
  }
  return codes
}
/**
 * Generate a new TOTP secret and the otpauth:// URI for QR rendering.
 */
// export function generateTotpSecret(email: string): {
//   secret:     string
//   otpauthUrl: string
// } {
//   const secret = generateSecret()
//   const otpauthUrl = generateURI({ issuer: 'GatewayAuth', label: email, secret })
//   return { secret, otpauthUrl }
// }

/**
 * Verify a 6-digit TOTP code against the stored secret.
 * Allows ±1 step window for clock drift.
 */
// export function verifyTotpCode(secret: string, code: string): boolean {
//   try {
//     return authenticator.check(code, secret)
//   } catch {
//     return false
//   }
// }

/**
 * Generate 8 one-time backup codes (hex strings).
 * Store their hashes — not these plaintext values.
 */
// export function generateBackupCodes(): string[] {
//   return Array.from({ length: 8 }, () => randomBytes(5).toString('hex').toUpperCase())
// }
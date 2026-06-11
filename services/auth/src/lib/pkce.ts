// services/auth/src/lib/pkce.ts
import { createHash, randomBytes } from 'node:crypto'

/**
 * Verify an OAuth PKCE code_verifier against a stored code_challenge.
 * Only S256 method is supported (plain is disabled per AGENTS.md).
 */
export function verifyPkceChallenge(
  codeVerifier:  string,
  codeChallenge: string,
): boolean {
  if (codeVerifier.length < 43 || codeVerifier.length > 128) return false

  const digest = createHash('sha256')
    .update(codeVerifier)
    .digest('base64url')

  return digest === codeChallenge
}

/**
 * Generate a cryptographically random authorization code (opaque).
 */
export function generateAuthCode(): string {
  return randomBytes(32).toString('base64url')
}
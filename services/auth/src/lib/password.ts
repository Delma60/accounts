// services/auth/src/lib/password.ts
import argon2 from 'argon2'

const ARGON2_OPTIONS: argon2.Options = {
  type:        argon2.argon2id,
  memoryCost:  65536,  // 64 MB
  timeCost:    3,
  parallelism: 4,
}

/**
 * Hash a plaintext password with Argon2id.
 * Never call this with an already-hashed value.
 */
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS)
}

/**
 * Verify a plaintext password against a stored Argon2 hash.
 * Returns true if it matches, false otherwise (never throws on mismatch).
 */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password)
  } catch {
    return false
  }
}
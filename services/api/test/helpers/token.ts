// services/api/test/helpers/token.ts
// Signs JWTs using the same Ed25519 key configured in vitest.config.ts
// so integration tests can send real (verifiable) tokens to the API.

import { SignJWT, importJWK, type JWK, type KeyLike } from 'jose'
import { randomUUID } from 'node:crypto'

let _privateKey: KeyLike | null = null

async function getPrivateKey(): Promise<KeyLike> {
  if (_privateKey) return _privateKey

  const b64  = process.env.TEST_JWT_PRIVATE_KEY_BASE64!
  const jwk: JWK = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'))
  _privateKey = await importJWK(jwk, 'EdDSA') as KeyLike
  return _privateKey
}

export interface TokenOptions {
  sub?:       string
  email?:     string
  scope?:     string
  audience?:  string
  issuer?:    string
  expiresIn?: string
  jti?:       string
}

/**
 * Sign a test access token with the mock Ed25519 private key.
 * Defaults match the vitest.config.ts environment so the API's JWKS
 * verification passes without any mocking.
 */
export async function signTestToken(opts: TokenOptions = {}): Promise<string> {
  const key = await getPrivateKey()
  const kid = process.env.TEST_JWT_KID ?? 'test-kid-api'

  return new SignJWT({
    sub:   opts.sub   ?? 'test-user-uuid-001',
    email: opts.email ?? 'test@example.com',
    scope: opts.scope ?? 'openid profile email',
    jti:   opts.jti   ?? randomUUID(),
  })
    .setProtectedHeader({ alg: 'EdDSA', kid })
    .setIssuer(opts.issuer   ?? process.env.GATEWAY_ISSUER!)
    .setAudience(opts.audience ?? process.env.SERVICE_NAME!)
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? '15m')
    .sign(key)
}
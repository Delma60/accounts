// services/auth/src/lib/token.ts
import {
  SignJWT,
  importJWK,
  exportJWK,
  generateKeyPair,
  type JWK,
  type KeyLike,
} from 'jose'
import { randomUUID } from 'node:crypto'
import { getAuthEnv } from './env.js'

// ── Key loading ───────────────────────────────────────────────────────────────

let _privateKey: KeyLike | null = null
let _publicJwk: JWK | null = null

export async function loadSigningKey(): Promise<void> {
  const env = getAuthEnv()
  const jwkJson = Buffer.from(env.JWT_PRIVATE_KEY_BASE64, 'base64').toString('utf8')
  const jwk: JWK = JSON.parse(jwkJson)
  _privateKey = await importJWK(jwk, 'EdDSA') as KeyLike

  // Derive public JWK from private
  const { publicKey } = await generateKeyPair('EdDSA')
  // We export the public portion from the private JWK by stripping 'd'
  const { d: _d, ...pubJwk } = jwk
  _publicJwk = { ...pubJwk, kid: env.JWT_KID, use: 'sig', alg: 'EdDSA' }
}

export function getPublicJwk(): JWK {
  if (!_publicJwk) throw new Error('Signing key not loaded — call loadSigningKey() first')
  return _publicJwk
}

function getPrivateKey(): KeyLike {
  if (!_privateKey) throw new Error('Signing key not loaded — call loadSigningKey() first')
  return _privateKey
}

// ── Token signing ─────────────────────────────────────────────────────────────

export interface AccessTokenClaims {
  sub:   string  // user ID
  email: string
  scope: string
}

export async function signAccessToken(claims: AccessTokenClaims): Promise<string> {
  const env = getAuthEnv()
  const jti = randomUUID()

  return new SignJWT({
    sub:   claims.sub,
    email: claims.email,
    scope: claims.scope,
    jti,
  })
    .setProtectedHeader({ alg: 'EdDSA', kid: env.JWT_KID })
    .setIssuer(env.GATEWAY_ISSUER)
    .setAudience('api-service')   // downstream services
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL}s`)
    .sign(getPrivateKey())
}

export async function signIdToken(claims: AccessTokenClaims & {
  name?: string
  emailVerified?: boolean
}): Promise<string> {
  const env = getAuthEnv()

  return new SignJWT({
    sub:            claims.sub,
    email:          claims.email,
    email_verified: claims.emailVerified ?? false,
    name:           claims.name,
    scope:          claims.scope,
  })
    .setProtectedHeader({ alg: 'EdDSA', kid: env.JWT_KID })
    .setIssuer(env.GATEWAY_ISSUER)
    .setAudience(claims.sub)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(getPrivateKey())
}

// ── Opaque token generation ───────────────────────────────────────────────────

export function generateOpaqueToken(): string {
  return randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '')
}
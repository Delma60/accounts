#!/usr/bin/env node

// infra/scripts/generate-jwk.mjs
import crypto from 'node:crypto';

console.log('🔑 Generating cryptographically secure Ed25519 (EdDSA) key pair...\n');

// 1. Generate an asymmetric Ed25519 key pair natively
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');

// 2. Export asymmetric keys directly into raw JWK data objects
const rawPrivateJwk = privateKey.export({ format: 'jwk' });
const rawPublicJwk = publicKey.export({ format: 'jwk' });

// 3. Generate a stable, random Key ID (kid) for tracking and rotation validation
const kid = crypto.randomUUID();

// 4. Construct complete JSON Web Keys matching the standard RFC 8037 specification
const privateJwk = {
  kty: 'OKP',
  crv: 'Ed25519',
  alg: 'EdDSA',
  use: 'sig',
  kid,
  x: rawPrivateJwk.x,
  d: rawPrivateJwk.d,
};

const publicJwk = {
  kty: 'OKP',
  crv: 'Ed25519',
  alg: 'EdDSA',
  use: 'sig',
  kid,
  x: rawPublicJwk.x,
};

// 5. Serialize and Base64-encode the private JWK as required by loadSigningKey()
const jwkJsonString = JSON.stringify(privateJwk);
const base64PrivateKey = Buffer.from(jwkJsonString, 'utf8').toString('base64');

// 6. Display formatting for your environment variables
console.log('======================================================================');
console.log('👉 TARGET ENVIRONMENT VARIABLES FOR YOUR AUTH SERVICE .env FILE');
console.log('======================================================================\n');
console.log(`JWT_KID="${kid}"`);
console.log(`JWT_PRIVATE_KEY_BASE64="${base64PrivateKey}"\n`);

console.log('======================================================================');
console.log('👉 PUBLIC JWK LOOKUP (For reference / debugging verification)');
console.log('======================================================================\n');
console.log(JSON.stringify(publicJwk, null, 2));
console.log('\n======================================================================');
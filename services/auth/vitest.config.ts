// services/auth/vitest.config.ts
import { defineConfig } from 'vitest/config'

const mockJwk = {
  kty: 'OKP',
  crv: 'Ed25519',
  alg: 'EdDSA',
  use: 'sig',
  kid: 'test-kid-12345',
  x: 'cvkusqVaW6LPY3y0408aX5A5mSKxFQ3momxjsJGu0lg',
  d: 'EyHlsOWlf61eCM417r5WAFoTqG5ia3q5bvIwHcFBkhw',
}
const mockJwkBase64 = Buffer.from(JSON.stringify(mockJwk)).toString('base64')

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Force Vitest to look specifically inside the local test directory
    include: ['test/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/lib/env.ts'],
    },
    env: {
      NODE_ENV: 'test',
      JWT_KID: 'test-kid-12345',
      JWT_PRIVATE_KEY_BASE64: mockJwkBase64,
      GATEWAY_ISSUER: 'http://localhost:3000',
      COOKIE_DOMAIN: 'localhost',
      ACCESS_TOKEN_TTL: '900',
      REFRESH_TOKEN_TTL: '604800',
      BAAS_PROJECT_ID: 'test-project-id',
      BAAS_API_KEY: 'test-api-key-string',
      COOKIE_SECRET: 'test-cookie-secret-minimum-32-characters-long'
    },
  },
})
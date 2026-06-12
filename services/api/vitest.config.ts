// services/api/vitest.config.ts
import { defineConfig } from 'vitest/config'

const mockJwk = {
  kty: 'OKP',
  crv: 'Ed25519',
  alg: 'EdDSA',
  use: 'sig',
  kid: 'test-kid-api',
  x: 'cvkusqVaW6LPY3y0408aX5A5mSKxFQ3momxjsJGu0lg',
  d: 'EyHlsOWlf61eCM417r5WAFoTqG5ia3q5bvIwHcFBkhw',
}
const mockJwkBase64 = Buffer.from(JSON.stringify(mockJwk)).toString('base64')

export default defineConfig({
  test: {
    globals:     true,
    environment: 'node',
    include:     ['test/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include:  ['src/**/*.ts'],
      exclude:  ['src/index.ts'],
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
    env: {
      NODE_ENV:              'test',
      SERVICE_NAME:          'api-service',
      GATEWAY_URL:           'http://localhost:4000',
      GATEWAY_ISSUER:        'http://localhost:3000',
      BAAS_PROJECT_ID:       'test-project-id',
      BAAS_API_KEY:          'test-api-key-string',
      CORS_ALLOWED_ORIGINS:  'http://localhost:3000',
      // Expose the mock JWK so tests can sign tokens with the same key
      TEST_JWT_PRIVATE_KEY_BASE64: mockJwkBase64,
      TEST_JWT_KID:          'test-kid-api',
    },
  },
})
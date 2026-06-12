# Gateway Monorepo — TODO

## packages (shared first) ✅

- [x] Create `packages/utils`: `createBaasClient()` factory and `verifyToken()` helper
- [x] Create `packages/types`: export Zod schemas and inferred TypeScript types for shared data
- [x] Create `packages/tsconfig`: shared tsconfig base for all services

---

## services/auth ✅

- [x] Set up Fastify app entry point with logger and plugin loading
- [x] Implement `POST /auth/register` with Zod validation and Argon2id hashing
- [x] Implement `POST /auth/login` with password verify, JWT signing (Ed25519), and httpOnly cookie
- [x] Implement `POST /auth/refresh` with refresh token rotation and replay detection
- [x] Implement `POST /auth/logout` — revoke refresh token in KV store
- [x] Implement TOTP enrolment and verification (`POST /auth/mfa/enroll` + `/verify`) using otplib
- [x] Implement password reset flow (`POST /auth/password/forgot` + `/reset`)
- [x] Implement OAuth 2.0 / PKCE authorize and token endpoints
- [x] Implement `GET /auth/userinfo` and OIDC discovery endpoints
- [x] Publish `GET /.well-known/jwks.json` with Ed25519 public key
- [x] Add KV-backed rate limiting via `@fastify/rate-limit` for all auth endpoints
- [x] Write audit log to NoSQL `audit_logs` collection on every auth event
- [x] Implement `GET /health` endpoint with BaaS probe
- [x] Expose `GET /metrics` via prom-client
- [x] Add `infra/scripts/generate-jwk.mjs` for Ed25519 key pair generation
- [x] Write integration tests for login, logout, refresh, and OAuth flows (≥ 90% coverage)
- [x] Add security tests: JWT algorithm confusion, PKCE bypass, refresh token replay

---

## apps/accounts-ui ✅

- [x] Scaffold Next.js 15 app with Tailwind 4 and TanStack Query
- [x] Build login page — `POST /auth/login`, handle MFA challenge redirect
- [x] Build registration page with client-side Zod validation
- [x] Build MFA enrolment and TOTP verification pages
- [x] Build password reset request and reset-form pages
- [x] Build OAuth consent screen
- [x] Implement silent token refresh via TanStack Query in the BFF layer
- [x] Ensure tokens are stored in httpOnly cookies only — no localStorage

---

## services/api ✅

- [x] Scaffold Fastify app entry point
- [x] Integrate `verifyToken()` from `packages/utils` to validate JWTs on every request
- [x] Enforce authorisation based on token scopes and user roles
- [x] Wire `BaasClient` using `createBaasClient()` from `packages/utils`
- [x] Implement job enqueueing via BullMQ (with `baas.functions` fallback when `REDIS_URL` unset)
- [x] Write integration tests (≥ 80% coverage) — JWT auth, scope enforcement, `/me`, `/health`, `/metrics`, job helpers

---

## services/worker

- [x] Scaffold BullMQ worker
- [ ] Implement transactional email sending (Resend/Postmark or `baas.functions`)
- [ ] Implement scheduled maintenance jobs (prune expired records, etc.)
- [ ] Set up worker authentication to `services/api` via long-lived API key (scope: `worker:internal`)
- [ ] Add 90-day rotation reminder for worker API key

---

## sdk (client libraries)

> Per AGENTS.md §6 (Gateway Design) and §8 (Authentication & Identity Protocol),
> the accounts gateway is the sole identity authority and exposes a stable OAuth
> 2.0 / OIDC + PKCE surface (`/auth/oauth/authorize`, `/auth/oauth/token`,
> `/auth/userinfo`, `/.well-known/jwks.json`, `/.well-known/openid-configuration`).
> These SDKs are the supported way for first- and third-party apps to integrate
> with that surface, rather than calling the gateway's REST endpoints directly.
> Both packages live under `packages/sdk-js` and `packages/sdk-python` (or a
> separate `sdks/` repo if published independently of the monorepo — decide
> before scaffolding).

### packages/sdk-js (TypeScript/JS client)

- [ ] Scaffold `packages/sdk-js` workspace package (`@app/gateway-sdk` or public npm name TBD)
- [ ] Implement PKCE helpers: `generateCodeVerifier()`, `generateCodeChallenge()`, `generateState()`
- [ ] Implement `getAuthorizeUrl({ clientId, redirectUri, scope, state, codeChallenge })`
- [ ] Implement `exchangeCodeForTokens({ code, codeVerifier, redirectUri, clientId })` → calls `/auth/oauth/token`
- [ ] Implement `refreshTokens({ refreshToken })` → calls `/auth/refresh` with rotation handling
- [ ] Implement `getUserInfo({ accessToken })` → calls `/auth/userinfo`
- [ ] Re-export `verifyAccessToken()` / `extractBearerToken()` from `@app/utils` for server-side token verification (JWKS-based, no gateway round-trip — AGENTS.md §8.3)
- [ ] Implement thin wrappers for `register`, `login`, `mfa/enroll`, `mfa/verify`, `mfa/activate`, `password/forgot`, `password/reset` (mirrors `apps/accounts-ui/src/lib/api.ts`)
- [ ] Add browser build target with cookie-based session support (no token storage in localStorage — AGENTS.md §7.4)
- [ ] Add Node/server build target for backend-to-gateway calls (service-to-service, AGENTS.md §10)
- [ ] Write unit tests (PKCE math, URL construction, token refresh rotation, error envelope parsing)
- [ ] Write usage docs + Quickstart README with login flow example
- [ ] Publish to npm (or internal registry) with versioning aligned to gateway API version

### packages/sdk-python (Python client)

- [ ] Scaffold `packages/sdk-python` (e.g. `gateway_sdk`) with `pyproject.toml`, packaging via `hatchling` or `poetry`
- [ ] Implement PKCE helpers (`generate_code_verifier`, `generate_code_challenge`, `generate_state`)
- [ ] Implement `get_authorize_url(...)`
- [ ] Implement `exchange_code_for_tokens(...)` → `/auth/oauth/token`
- [ ] Implement `refresh_tokens(...)` → `/auth/refresh`
- [ ] Implement `get_userinfo(access_token)` → `/auth/userinfo`
- [ ] Implement local JWT verification against JWKS (EdDSA/Ed25519 only, reject HS256 — mirrors `packages/utils/src/verify-token.ts` and AGENTS.md §11.2) using `pyjwt` + `cryptography`, with JWKS caching/refresh
- [ ] Implement thin wrappers for `register`, `login`, `mfa_enroll`, `mfa_verify`, `mfa_activate`, `forgot_password`, `reset_password`
- [ ] Provide both sync and async client variants (`httpx`-based)
- [ ] Write unit tests (PKCE math, JWKS verification incl. algorithm-confusion rejection, refresh rotation, error envelope parsing)
- [ ] Write usage docs + Quickstart README with login flow example
- [ ] Publish to PyPI (or internal index) with versioning aligned to gateway API version

### shared

- [ ] Define a shared "gateway API contract" doc (OpenAPI or hand-written) so JS/Python SDKs and `packages/types` stay in sync
- [ ] Add a CI check that fails if a gateway endpoint changes without a corresponding SDK changelog entry
- [ ] Add cross-SDK integration test: spin up `services/auth` in test mode, run the same OAuth/PKCE flow from both SDKs against it

---

## infra ✅

- [x] Write Dockerfiles for `services/auth`, `services/api`, `services/worker`, `apps/accounts-ui`
- [x] Write `infra/docker-compose.yml` (production) and `docker-compose.dev.yml`
- [x] Configure Nginx server blocks for accounts, api, and www subdomains in `infra/nginx/`
- [ ] Configure Certbot for Let's Encrypt auto-renewal on VPS-1  ← run on server
- [ ] Configure UFW firewall rules on VPS-1/VPS-2 ← run on server (scripts provided)
- [ ] Set up Prometheus + Grafana dashboards and alert rules on VPS-2  ← run on server
- [ ] Configure OpenTelemetry export to local Jaeger instance  ← runtime config
- [x] Write `infra/scripts/rotate-secrets.sh` (`make rotate-secrets` target)
- [x] Add `.env.example` to every service and verify `.gitignore` covers all `.env*` files

---

## ci/cd ✅

- [x] Create `.github/workflows/ci.yml`: npm ci, lint, typecheck, test, build on every PR
- [x] Create `.github/workflows/deploy.yml`: build images, SSH to VPS-2, write `.env.production`, `docker compose up`
- [ ] Store all secrets (JWT keys, BaaS keys, Spur Connect creds) in GitHub Secrets  ← manual step
- [x] Implement zero-downtime deploy pattern: rolling restart with `/health` check
- [x] Tag Docker images with git SHA and keep last 5 in registry
- [x] Add rollback script: redeploy previous git SHA image
- [ ] Add SDK release pipeline: build + publish `packages/sdk-js` to npm and `packages/sdk-python` to PyPI on tagged release
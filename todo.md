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

## services/api

- [x] Scaffold Fastify app entry point
- [ ] Integrate `verifyToken()` from `packages/utils` to validate JWTs on every request
- [ ] Enforce authorisation based on token scopes and user roles
- [ ] Wire `BaasClient` using `createBaasClient()` from `packages/utils`
- [ ] Implement job enqueueing via BullMQ or `baas.functions` for async work
- [ ] Write integration tests (≥ 80% coverage)

---

## services/worker

- [x] Scaffold BullMQ worker
- [ ] Implement transactional email sending (Resend/Postmark or `baas.functions`)
- [ ] Implement scheduled maintenance jobs (prune expired records, etc.)
- [ ] Set up worker authentication to `services/api` via long-lived API key (scope: `worker:internal`)
- [ ] Add 90-day rotation reminder for worker API key

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
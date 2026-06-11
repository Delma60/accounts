# Gateway Monorepo — TODO

## packages (shared first)

- [ ] Create `packages/utils`: `createBaasClient()` factory and `verifyToken()` helper
- [ ] Create `packages/types`: export Zod schemas and inferred TypeScript types for shared data
- [ ] Create `packages/tsconfig`: shared tsconfig base for all services

---

## services/auth

- [ ] Set up Fastify app entry point with logger and plugin loading
- [ ] Implement `POST /auth/register` with Zod validation and Argon2id hashing
- [ ] Implement `POST /auth/login` with password verify, JWT signing (Ed25519), and httpOnly cookie
- [ ] Implement `POST /auth/refresh` with refresh token rotation and replay detection
- [ ] Implement `POST /auth/logout` — revoke refresh token in KV store
- [ ] Implement TOTP enrolment and verification (`POST /auth/mfa/enroll` + `/verify`) using otplib
- [ ] Implement password reset flow (`POST /auth/password/forgot` + `/reset`)
- [ ] Implement OAuth 2.0 / PKCE authorize and token endpoints
- [ ] Implement `GET /auth/userinfo` and OIDC discovery endpoints
- [ ] Publish `GET /.well-known/jwks.json` with Ed25519 public key
- [ ] Add KV-backed rate limiting via `@fastify/rate-limit` for all auth endpoints
- [ ] Write audit log to Sql `audit_logs` collection on every auth event
- [ ] Implement `GET /health` endpoint with BaaS probe
- [ ] Expose `GET /metrics` via prom-client
- [ ] Add `infra/scripts/generate-jwk.mjs` for Ed25519 key pair generation
- [ ] Write integration tests for login, logout, refresh, and OAuth flows (≥ 90% coverage)
- [ ] Add security tests: JWT algorithm confusion, PKCE bypass, refresh token replay

---

## apps/accounts-ui

- [ ] Scaffold Next.js 15 app with Tailwind 4 and TanStack Query
- [ ] Build login page — `POST /auth/login`, handle MFA challenge redirect
- [ ] Build registration page with client-side Zod validation
- [ ] Build MFA enrolment and TOTP verification pages
- [ ] Build password reset request and reset-form pages
- [ ] Build OAuth consent screen
- [ ] Implement silent token refresh via TanStack Query in the BFF layer
- [ ] Ensure tokens are stored in httpOnly cookies only — no localStorage

---

## services/api

- [ ] Scaffold Fastify app entry point
- [ ] Integrate `verifyToken()` from `packages/utils` to validate JWTs on every request
- [ ] Enforce authorisation based on token scopes and user roles
- [ ] Wire `BaasClient` using `createBaasClient()` from `packages/utils`
- [ ] Implement job enqueueing via BullMQ or `baas.functions` for async work
- [ ] Write integration tests (≥ 80% coverage)

---

## services/worker

- [ ] Scaffold BullMQ worker
- [ ] Implement transactional email sending (Resend/Postmark or `baas.functions`)
- [ ] Implement scheduled maintenance jobs (prune expired records, etc.)
- [ ] Set up worker authentication to `services/api` via long-lived API key (scope: `worker:internal`)
- [ ] Add 90-day rotation reminder for worker API key

---

## infra

- [ ] Write Dockerfiles for `services/auth`, `services/api`, `services/worker`, `apps/accounts-ui`
- [ ] Write `infra/docker-compose.yml` (production) and `docker-compose.dev.yml`
- [ ] Configure Nginx server blocks for accounts, api, and www subdomains in `infra/nginx/`
- [ ] Configure Certbot for Let's Encrypt auto-renewal on VPS-1
- [ ] Configure UFW firewall rules on VPS-1 (allow 80/443) and VPS-2 (allow from VPS-1 only)
- [ ] Set up Prometheus + Grafana dashboards and alert rules on VPS-2
- [ ] Configure OpenTelemetry export to local Jaeger instance
- [ ] Write `infra/scripts/rotate-secrets.sh` (`make rotate-secrets` target)
- [ ] Add `.env.example` to every service and verify `.gitignore` covers all `.env*` files

---

## ci/cd

- [ ] Create `.github/workflows/ci.yml`: npm ci, lint, typecheck, test, build on every PR
- [ ] Create `.github/workflows/deploy.yml`: build images, SSH to VPS-2, write `.env.production`, `docker compose up`
- [ ] Store all secrets (JWT keys, BaaS keys, Spur Connect creds) in GitHub Secrets
- [ ] Implement zero-downtime deploy pattern: rolling restart with `/health` check
- [ ] Tag Docker images with git SHA and keep last 5 in registry
- [ ] Add rollback script: redeploy previous git SHA image
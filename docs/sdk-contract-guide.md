# docs/sdk-contract-guide.md
<!-- docs/sdk-contract-guide.md -->

# SDK Contract Guide

This document explains the three interlocking pieces that keep
`packages/sdk-js`, `packages/sdk-python`, and `packages/types` in sync with
the gateway implementation in `services/auth`.

---

## 1. The API Contract (`docs/api-contract.yaml`)

`docs/api-contract.yaml` is the **single source of truth** for every endpoint,
request shape, and response shape the gateway exposes.

### What it covers

| Tag      | Endpoints                                                    |
|----------|--------------------------------------------------------------|
| System   | `/health`, `/metrics`                                        |
| OIDC     | `/.well-known/jwks.json`, `/.well-known/openid-configuration`, `/auth/userinfo` |
| Auth     | `/auth/register`, `/auth/login`, `/auth/logout`, `/auth/refresh` |
| MFA      | `/auth/mfa/enroll`, `/auth/mfa/activate`, `/auth/mfa/verify` |
| Password | `/auth/password/forgot`, `/auth/password/reset`              |
| OAuth    | `/auth/oauth/authorize`, `/auth/oauth/token`                 |

### Schema alignment

Every `components/schemas` entry includes a comment pointing to its Zod
counterpart in `packages/types/src`:

```yaml
# → packages/types/src/user.ts  LoginSuccessResponseSchema
TokenResponse:
  type: object
  required: [accessToken, refreshToken, expiresIn, tokenType]
  ...
```

When you add or change a schema here, update `packages/types` to match.

### Versioning

Bump `info.version` in the YAML on every meaningful change:

| Change type                                     | Bump  |
|-------------------------------------------------|-------|
| Removed field, changed status code, removed path | MAJOR |
| New endpoint, new optional field                 | MINOR |
| Description-only edit, example update            | PATCH |

Add a line to the `CHANGELOG` block at the top of the file.

---

## 2. CI Contract Guard (`.github/workflows/contract-guard.yml`)

Runs on every PR that touches `services/auth/src/routes/**`,
`docs/api-contract.yaml`, or `packages/types/src/**`.

### Checks performed

| # | Check | Failure behaviour |
|---|-------|-------------------|
| 1 | **OpenAPI lint** — `@redocly/cli lint` on the YAML | Hard fail |
| 2 | **Route diff** — routes registered in source vs paths in contract | Hard fail if source route is undocumented |
| 3 | **Version bump** — `info.version` must change if `operationId`s change | Hard fail |
| 4 | **Types coverage** — each contract schema should have a `*Schema` Zod export | Warning only |

### What triggers a hard failure

```
┌─ PR touches services/auth/src/routes/login.ts ─────────────────────────────┐
│  Developer adds POST /auth/login/social (new social login endpoint)         │
│                                                                             │
│  ❌ Check 2 fails: route in source, missing from contract                  │
│  ❌ Check 3 fails: operationIds changed, info.version not bumped            │
│                                                                             │
│  Fix: add the path to docs/api-contract.yaml, bump info.version, add       │
│       a CHANGELOG entry, add a *Schema to packages/types if needed.        │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Cross-SDK Integration Test (`tests/cross-sdk/run-oauth-flow.mjs`)

Runs the **complete OAuth 2.0 / PKCE flow** against a live `services/auth`
instance. The same test suite is labelled "JS SDK" and "Python SDK" so SDK
authors have a runnable reference for every HTTP call their library needs
to make.

### What it tests

```
Discovery & Health
  ✅ GET /health
  ✅ GET /.well-known/openid-configuration
  ✅ GET /.well-known/jwks.json

Registration
  ✅ POST /auth/register → 201
  ✅ Duplicate email → 409
  ✅ Weak password  → 400

Login
  ✅ Wrong credentials → 401
  ✅ Valid credentials → 200 + token pair

Token Refresh
  ✅ Rotate token pair
  ✅ Replay consumed token → 401

UserInfo
  ✅ No token       → 401
  ✅ Valid Bearer   → 200 + claims

OAuth 2.0 / PKCE  (run twice: JS SDK + Python SDK)
  ✅ Generate code_verifier + code_challenge (S256)
  ✅ GET /auth/oauth/authorize → auth code
  ✅ POST /auth/oauth/token   → access + id + refresh tokens
  ✅ Wrong code_verifier      → 400 invalid_grant  (PKCE bypass protection)
  ✅ Replay consumed code     → 400 invalid_grant  (code replay protection)
  ✅ OAuth access_token accepted by /auth/userinfo

Password Reset
  ✅ POST /auth/password/forgot always returns 200 (anti-enumeration)
  ✅ Invalid reset token → 400

Logout
  ✅ POST /auth/logout  → 200
  ✅ Refresh after logout → 401
```

### Running locally

```bash
# Against the dev server (must already be running on port 4000):
GATEWAY_URL=http://localhost:4000 START_SERVICE=false node tests/cross-sdk/run-oauth-flow.mjs

# Self-contained (script starts services/auth internally, then tears it down):
node tests/cross-sdk/run-oauth-flow.mjs
```

### CI

`cross-sdk-integration.yml` runs this test on every push to `main` and on
PRs that touch `services/auth/src/**` or `tests/cross-sdk/**`.

---

## Adding a new endpoint — checklist

1. Implement the route in `services/auth/src/routes/`.
2. Add the path + operationId to `docs/api-contract.yaml`.
3. Bump `info.version` and add a `CHANGELOG` entry.
4. Add or update the matching `*Schema` in `packages/types/src/`.
5. Add an assertion for the new endpoint in `tests/cross-sdk/run-oauth-flow.mjs`.
6. Update `packages/sdk-js` and `packages/sdk-python` wrapper methods.
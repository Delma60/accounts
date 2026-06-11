# AGENTS.md — Gateway Architecture & Engineering Guide

> This file is the **primary technical reference** for this codebase.
> It defines the accounts gateway design, the full technology stack, infrastructure
> layout, service boundaries, worker roles, and contribution protocols.
>
> **Every contributor and automated pipeline operating in this repository must read
> and comply with this document before writing a single line of code.**

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture Philosophy](#2-architecture-philosophy)
3. [Technology Stack](#3-technology-stack)
4. [Infrastructure Layout (VPS / Self-hosted)](#4-infrastructure-layout-vps--self-hosted)
5. [Repository Structure](#5-repository-structure)
6. [Gateway Design (accounts layer)](#6-gateway-design-accounts-layer)
7. [Service Roles & Boundaries](#7-service-roles--boundaries)
8. [Authentication & Identity Protocol](#8-authentication--identity-protocol)
9. [Session & Token Management](#9-session--token-management)
10. [Service-to-Service Communication](#10-service-to-service-communication)
11. [Security Policies](#11-security-policies)
12. [Data Flow Diagrams](#12-data-flow-diagrams)
13. [Environment & Configuration](#13-environment--configuration)
14. [Testing & Validation Requirements](#14-testing--validation-requirements)
15. [Error Handling Standards](#15-error-handling-standards)
16. [Deployment & Operations](#16-deployment--operations)
17. [Contribution & Change Protocol](#17-contribution--change-protocol)

---

## 1. Project Overview

This repository implements **[YOUR_PROJECT_NAME]** — a multi-service platform built
on Node.js / TypeScript and self-hosted on VPS infrastructure.

The entry point of the entire architecture is an **accounts gateway** modelled after
the `accounts.google.com` pattern: one domain, one identity authority, one front door.

The accounts gateway is responsible for:

- User identity verification (registration, login, MFA)
- Issuing and validating JWT access tokens for all downstream services
- OAuth 2.0 / OpenID Connect flows for third-party app integrations
- Single Sign-On (SSO) across all internal services
- Rate-limiting, abuse detection, and bot mitigation at the perimeter

All downstream services **trust only tokens issued by this gateway**.
No downstream service authenticates users independently.

---

## 2. Architecture Philosophy

### The Gateway is the Source of Truth for Identity

Just as `accounts.google.com` is the sole identity authority for all of Google's
products, this gateway is the sole identity authority for every service on this
platform. The consequences:

- **One login, everywhere.** A user authenticated at the gateway is authenticated
  across the entire platform without re-prompting.
- **One revocation point.** Revoking a token, disabling an account, or rotating
  credentials happens once at the gateway and propagates everywhere instantly.
- **One audit trail.** All authentication events are logged at the gateway.
  Downstream services do not maintain their own auth logs.

### Services are Dumb About Identity

Downstream services receive a token, verify its signature against the gateway's
public key, extract the claims they need, and proceed. They never implement login
flows, never store passwords, and never issue their own tokens.

### Monorepo, Modular Services

All services live in a single monorepo (managed with npm workspaces). Each service
is independently deployable as a Docker container. They share TypeScript types and
utility libraries via internal workspace packages but have no shared runtime state.

### Medium-Scale Defaults

This architecture is designed for a growing product — not a toy, not a Fortune 500
enterprise. Defaults are chosen to be operationally simple on a VPS while leaving
clear upgrade paths as traffic grows.

- **Spur Connect** as the unified data layer (SQL, NoSQL, KV, Storage, Auth, Realtime)
- Nginx as the reverse proxy / TLS terminator (not a full service mesh)
- Docker Compose on each VPS node (Kubernetes is the upgrade path)
- GitHub Actions for CI/CD

---

## 3. Technology Stack

### 3.1 Language & Runtime

| Layer           | Choice                       | Version  | Reason                                           |
|-----------------|------------------------------|----------|--------------------------------------------------|
| Language        | TypeScript (strict mode)     | 5.x      | Type safety across the full codebase             |
| Runtime         | Node.js LTS                  | 22.x     | Long-term support, native ESM, solid crypto APIs |
| Package manager | npm                          | 10.x     | Workspace support; lockfile in repo              |
| Module format   | ESM (`"type": "module"`)     | —        | Native imports, no CommonJS interop debt         |

### 3.2 Web Framework

| Package         | Version | Rationale                                                                 |
|-----------------|---------|---------------------------------------------------------------------------|
| **fastify**     | 5.x     | Fastest Node.js HTTP framework; schema-based validation; TypeScript-first |

```typescript
// Standard service bootstrap
import Fastify from 'fastify'

const app = Fastify({ logger: true })
await app.register(import('./plugins/auth.js'))
await app.register(import('./routes/index.js'))
await app.listen({ port: 3000, host: '0.0.0.0' })
```

### 3.3 Database & Data Layer — Spur Connect

All data access (SQL, NoSQL, KV, file storage) goes through **Spur Connect**
(`@spurs-baas/sdk`). This is the project's unified BaaS layer. There is no direct
Postgres driver, no Redis client, and no ORM in service code — all data operations
use the `BaasClient`.

| Module             | Backing store   | Use                                                       |
|--------------------|-----------------|-----------------------------------------------------------|
| `baas.db(table)`   | PostgreSQL      | Relational data — users, sessions, app domain records     |
| `baas.nosql(col)`  | MongoDB         | Document data — flexible schemas, nested objects          |
| `baas.kv`          | MongoDB KV      | Ephemeral key-value — rate limits, session metadata, flags |
| `baas.storage(bucket)` | MinIO       | File uploads — presigned PUT/GET, never proxied           |
| `baas.auth`        | Spur Auth       | Project-scoped user auth (used by `accounts-ui` only)     |
| `baas.realtime`    | Socket.io       | Change subscriptions on SQL tables and NoSQL collections  |
| `baas.functions`   | Edge functions  | Async/remote work invoked from services                   |

**SDK package:** `@spurs-baas/sdk`  
**Backend URL:** `https://bass-backend.onrender.com` (set via `BAAS_BASE_URL`)

```typescript
// Standard client initialisation — one instance per service
import { BaasClient } from '@spurs-baas/sdk'

const baas = new BaasClient({
  projectId: process.env.BAAS_PROJECT_ID!,
  apiKey:    process.env.BAAS_API_KEY!,
  baseUrl:   process.env.BAAS_BASE_URL,   // falls back to BAAS_BASE_URL env var
})
```

#### SQL (PostgreSQL via Spur Connect)

```typescript
// Query
const { data } = await baas.db('users')
  .select('id, email, created_at')
  .filter('status', 'eq', 'active')
  .order('created_at', 'desc')
  .limit(20)
  .execute()

// Insert
const user = await baas.db('users').insert({ email: 'a@b.com', status: 'active' })

// Update
await baas.db('users').update(userId, { status: 'suspended' })

// Delete
await baas.db('users').delete(userId)

// Single row
const row = await baas.db('users').getById(userId)

// Postgres function (RPC)
const results = await baas.db.rpc('search_users').call({ query: 'alice' })
```

Schema migrations are managed through the Spur Connect dashboard.
There is no `db:migrate` script in service code.

#### NoSQL (MongoDB via Spur Connect)

```typescript
// Find with filter
const { data } = await baas.nosql('audit_logs')
  .find({ userId, event: 'login' })
  .sort({ createdAt: -1 })
  .limit(50)
  .execute()

// Insert
const doc = await baas.nosql('audit_logs').insertOne({ userId, event: 'login', ip })

// Update (auto-wraps plain objects in $set)
await baas.nosql('audit_logs').updateOne(docId, { resolved: true })

// Aggregation pipeline
const stats = await baas.nosql('events').aggregate([
  { $match: { type: 'auth.failure' } },
  { $group: { _id: '$ip', count: { $sum: 1 } } },
])
```

#### Key-Value Store

```typescript
// Rate limit counter (TTL-based)
await baas.kv.set(`rate:login:${ip}`, count, { ttl: 900 })
const hits = await baas.kv.get(`rate:login:${ip}`)

// Revocation flag
await baas.kv.set(`revoked:${tokenId}`, '1', { ttl: remainingLifetime })
const isRevoked = await baas.kv.get(`revoked:${tokenId}`)

// Batch operations
await baas.kv.batch([
  { op: 'set', key: 'a', value: 1 },
  { op: 'get', key: 'b' },
  { op: 'delete', key: 'c' },
])
```

#### File Storage

```typescript
// Get a presigned upload URL (file goes directly to storage, never through the server)
const { uploadUrl, fileUrl } = await baas.storage('avatars').upload({
  filename:    'profile.jpg',
  contentType: 'image/jpeg',
})
await fetch(uploadUrl, { method: 'PUT', body: fileBlob })
// fileUrl is the permanent download URL

// List files
const files = await baas.storage('docs').listFiles({ prefix: 'reports/' })

// Presigned download URL
const { url } = await baas.storage('docs').getDownloadUrl('report.pdf', { expiresIn: 300 })
```

#### Realtime

```typescript
// Subscribe to SQL table changes
const unsub = baas.realtime.on('sessions', (event) => {
  console.log(event.type, event.record) // INSERT | UPDATE | DELETE
})

// Subscribe to NoSQL collection changes
const unsub2 = baas.realtime.onCollection('audit_logs', handler, {
  eventTypes: ['INSERT'],
})

// Unsubscribe
unsub()
baas.destroy() // closes Socket.io connection on shutdown
```

#### Edge Functions

```typescript
// Invoke a named function
const result = await baas.functions
  .invoke('send-email')
  .with({ to: 'user@example.com', subject: 'Verify your email', templateId: 'verify' })
  .call()
```

### 3.4 Authentication Libraries (gateway service only)

| Package             | Version | Purpose                                                   |
|---------------------|---------|-----------------------------------------------------------|
| **jose**            | latest  | JWT signing, verification, JWKS; RFC-compliant, zero deps |
| **otplib**          | latest  | TOTP (Google Authenticator compatible) for MFA            |
| **argon2**          | latest  | Password hashing — Argon2id, winner of the PHC            |
| **@simplewebauthn** | latest  | Passkey / WebAuthn enrolment and assertion                |

> Note: `baas.auth` (Spur Connect's built-in auth module) is used only by
> `apps/accounts-ui` for project-scoped end-user sessions. The gateway's own
> identity operations (JWT signing, Argon2, TOTP) remain in `services/auth`.

### 3.5 Validation & Schemas

| Package       | Version | Use                                                                  |
|---------------|---------|----------------------------------------------------------------------|
| **zod**       | 3.x     | Runtime schema validation; shared between server and client          |
| **fastify**   | 5.x     | JSON Schema for route-level input validation (auto-serialisation)    |

Zod schemas are the single source of truth. They are compiled to JSON Schema for
Fastify and exported as TypeScript types for the frontend.

### 3.6 Messaging / Event Bus

| Package       | Version | Rationale                                                      |
|---------------|---------|----------------------------------------------------------------|
| **bullmq**    | latest  | Redis-backed job queue; reliable, retryable background workers |

BullMQ connects to the Redis instance managed by Spur Connect under the hood via
the project's KV store for lightweight signals, or directly via `REDIS_URL` for
the worker queue if a dedicated Redis is provisioned. The upgrade path to
RabbitMQ or Kafka is straightforward when needed.

### 3.7 Observability

| Package / Tool                  | Version | Purpose                                         |
|---------------------------------|---------|-------------------------------------------------|
| **pino**                        | latest  | Structured JSON logging (built into Fastify)    |
| **pino-pretty**                 | latest  | Human-readable logs in local dev                |
| **@opentelemetry/node**         | latest  | Traces exported to a local Jaeger instance      |
| **prom-client**                 | latest  | Prometheus metrics endpoint (`/metrics`)        |
| **Grafana + Prometheus**        | latest  | Dashboards and alerting on the VPS              |

### 3.8 Frontend

| Package          | Version | Rationale                                            |
|------------------|---------|------------------------------------------------------|
| **next**         | 15.x    | SSR + SSG; API routes for BFF pattern                |
| **tailwindcss**  | 4.x     | Utility-first, fast to iterate                       |
| **@tanstack/react-query** | 5.x | Server state, token refresh handling on the client |
| **react**        | 19.x    | UI library                                           |

The login / registration UI lives at `accounts.yourdomain.com` and is served by the
gateway's own Next.js frontend package (`/apps/accounts-ui`).

### 3.9 Developer Tooling

| Package / Tool      | Version | Use                                              |
|---------------------|---------|--------------------------------------------------|
| **eslint**          | 9.x     | Linting (typescript-eslint flat config)          |
| **prettier**        | 3.x     | Code formatting                                  |
| **vitest**          | 2.x     | Unit and integration tests                       |
| **supertest**       | latest  | HTTP integration tests against Fastify           |
| **Docker**          | 27.x    | Containerisation for all services                |
| **Docker Compose**  | 2.x     | Local dev and VPS deployment orchestration       |
| **GitHub Actions**  | —       | CI/CD pipelines                                  |

---

## 4. Infrastructure Layout (VPS / Self-hosted)

### 4.1 Node Topology

For a medium-scale product, the recommended starting layout is **2 VPS nodes**
(Spur Connect manages the data tier externally):

```
┌─────────────────────────────────────────────────────────┐
│                     Public Internet                      │
└───────────────────────┬─────────────────────────────────┘
                        │ HTTPS (443) / HTTP (80)
                        ▼
┌─────────────────────────────────────────────────────────┐
│                  VPS-1: Edge / Proxy                     │
│                                                         │
│  Nginx (reverse proxy + TLS termination)                │
│  Certbot (Let's Encrypt auto-renewal)                   │
│  Fail2ban (brute-force protection)                      │
│  UFW firewall                                           │
└──────────┬──────────────────────────────────────────────┘
           │ internal network
           ▼
┌──────────────────────┐     ┌──────────────────────────────┐
│  VPS-2: App Server   │     │  Spur Connect (external)      │
│                      │     │                               │
│  Docker Compose:     │────►│  PostgreSQL (SQL)             │
│  - gateway (auth)    │     │  MongoDB (NoSQL + KV)         │
│  - api-service       │     │  MinIO (Storage)              │
│  - worker-service    │     │  Socket.io (Realtime)         │
│  - accounts-ui       │     │  Edge Functions               │
│                      │     │  Auth module                  │
└──────────────────────┘     └──────────────────────────────┘
```

**VPS recommendations (starting point):**

| Node   | Provider suggestions                    | Spec (starting)        |
|--------|-----------------------------------------|------------------------|
| VPS-1  | Hetzner CX22, DigitalOcean Droplet      | 2 vCPU, 4 GB RAM       |
| VPS-2  | Hetzner CX32, Contabo VPS M             | 4 vCPU, 8 GB RAM       |

All nodes must be in the **same datacenter region** and connected via a private
network so inter-node traffic is never exposed to the public internet.

### 4.2 DNS Layout

| Record                              | Points to | Purpose                     |
|-------------------------------------|-----------|-----------------------------|
| `accounts.yourdomain.com`           | VPS-1 IP  | Auth gateway + login UI     |
| `api.yourdomain.com`                | VPS-1 IP  | Main API service            |
| `yourdomain.com` / `www`            | VPS-1 IP  | Marketing / app frontend    |

All records are A records. TTL: 300s (allows fast failover).

### 4.3 Nginx Configuration Sketch

Each subdomain gets its own Nginx server block on VPS-1:

```nginx
# /etc/nginx/sites-available/accounts.yourdomain.com
server {
    listen 443 ssl http2;
    server_name accounts.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/accounts.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/accounts.yourdomain.com/privkey.pem;

    # TLS hardening
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers   HIGH:!aNULL:!MD5;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload";

    location / {
        proxy_pass         http://VPS-2-PRIVATE-IP:4000;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
```

### 4.4 Docker Compose (VPS-2)

All services on the app server run under a single `docker-compose.yml`. Services
communicate over a private Docker bridge network — nothing is exposed publicly except
via the ports that Nginx proxies to.

```yaml
# docker-compose.yml (VPS-2)
version: '3.9'

networks:
  internal:
    driver: bridge

services:
  gateway:
    build: ./services/auth
    restart: unless-stopped
    networks: [internal]
    ports: ['4000:4000']        # proxied by Nginx on VPS-1
    env_file: ./services/auth/.env.production

  api:
    build: ./services/api
    restart: unless-stopped
    networks: [internal]
    ports: ['4001:4001']
    env_file: ./services/api/.env.production

  worker:
    build: ./services/worker
    restart: unless-stopped
    networks: [internal]
    env_file: ./services/worker/.env.production

  accounts-ui:
    build: ./apps/accounts-ui
    restart: unless-stopped
    networks: [internal]
    ports: ['3000:3000']
```

> No Redis or Postgres containers are needed on VPS-2 — all data is managed
> through Spur Connect.

### 4.5 Secrets Management (Self-hosted)

For a self-hosted VPS setup without a cloud secrets manager:

- **Environment files** (`.env.production`) stored on the server, **never committed
  to git**. `.gitignore` must list all `.env*` files except `.env.example`.
- **Deployment pipeline** uses GitHub Actions secrets to SSH into VPS-2 and write
  the `.env.production` files before `docker compose up -d`.
- **Rotation** is done manually via the deployment pipeline. Add a `make rotate-secrets`
  target that re-generates keys and re-deploys.
- **Upgrade path**: HashiCorp Vault OSS on a dedicated node when the team grows.

### 4.6 Backups

Spur Connect manages the persistence and backup of all project data (PostgreSQL,
MongoDB, MinIO). For service-level backups:

| Data              | Tool                         | Schedule      | Destination                            |
|-------------------|------------------------------|---------------|----------------------------------------|
| `.env` files      | Manual encrypted archive     | On rotation   | Remote object storage (encrypted)      |
| Application logs  | Log shipping via pino         | Continuous    | Centralised log store / S3-compatible  |

Spur Connect backup retention and disaster recovery policies apply to all
project data stored via the SDK.

---

## 5. Repository Structure

```
/
├── apps/
│   └── accounts-ui/          # Next.js login/register/MFA UI
│       ├── src/
│       └── package.json
│
├── services/
│   ├── auth/                 # The gateway — sole identity authority
│   │   ├── src/
│   │   │   ├── plugins/      # Fastify plugins (jwt, rate-limit, etc.)
│   │   │   ├── routes/       # Endpoint handlers
│   │   │   ├── lib/          # Token, password, MFA logic
│   │   │   └── index.ts
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   ├── api/                  # Main business logic API
│   │   └── ...
│   │
│   └── worker/               # BullMQ background workers
│       └── ...
│
├── packages/
│   ├── types/                # Shared TypeScript types (Zod schemas → TS)
│   ├── utils/                # Shared utilities (logger, env parser, baas client factory)
│   └── tsconfig/             # Shared tsconfig base
│
├── infra/
│   ├── nginx/                # Nginx config files
│   ├── docker-compose.yml    # Production compose file
│   ├── docker-compose.dev.yml
│   └── scripts/              # Rotation, deploy scripts
│
├── .github/
│   └── workflows/
│       ├── ci.yml            # Test + lint on every PR
│       └── deploy.yml        # Deploy to VPS on merge to main
│
├── AGENTS.md                 # ← this file
├── setup.bat                 # Windows dev environment bootstrap
└── package.json
```

> `packages/utils` exports a `createBaasClient()` factory that services import
> instead of constructing `BaasClient` directly. This centralises config and
> allows easy mocking in tests.

---

## 6. Gateway Design (accounts layer)

### 6.1 Domain & Routing

| Environment | Gateway URL                               |
|-------------|-------------------------------------------|
| Production  | `https://accounts.yourdomain.com`         |
| Staging     | `https://accounts.staging.yourdomain.com` |
| Local dev   | `http://localhost:4000`                   |

All traffic that touches identity must route through this URL. Services must **not**
expose auth endpoints on their own domains.

### 6.2 Endpoints

| Endpoint                                 | Auth required          | Purpose                                  |
|------------------------------------------|------------------------|------------------------------------------|
| `POST /auth/register`                    | No                     | Create a new user account                |
| `POST /auth/login`                       | No                     | Authenticate and receive tokens          |
| `POST /auth/logout`                      | Access token           | Invalidate session / revoke refresh token|
| `POST /auth/refresh`                     | Refresh token          | Exchange refresh token for new access token |
| `POST /auth/mfa/enroll`                  | Access token           | Enrol TOTP for a user                    |
| `POST /auth/mfa/verify`                  | Challenge ID           | Verify MFA challenge                     |
| `POST /auth/password/forgot`             | No                     | Send password reset email                |
| `POST /auth/password/reset`              | Reset token            | Set new password                         |
| `GET  /auth/oauth/authorize`             | No (user logs in here) | Start OAuth 2.0 auth code flow           |
| `POST /auth/oauth/token`                 | Client creds           | Exchange auth code for tokens            |
| `POST /auth/oauth/revoke`                | Access token           | Revoke an OAuth token                    |
| `GET  /auth/userinfo`                    | Access token           | Return claims for current token          |
| `GET  /.well-known/jwks.json`            | No                     | Public keys for token verification       |
| `GET  /.well-known/openid-configuration` | No                     | OIDC discovery document                  |
| `GET  /health`                           | No                     | Health check                             |
| `GET  /metrics`                          | Internal only          | Prometheus metrics                       |

### 6.3 Token Types

| Token         | Format | Lifetime   | Purpose                                      |
|---------------|--------|------------|----------------------------------------------|
| Access Token  | JWT    | 15 minutes | Authorise requests to downstream services    |
| Refresh Token | opaque | 30 days    | Obtain new access tokens; rotated on use     |
| ID Token      | JWT    | 1 hour     | User identity claims (OIDC)                  |
| API Key       | opaque | 90 days max| Long-lived developer integrations            |

---

## 7. Service Roles & Boundaries

Each service owns its domain completely. No service may bypass Spur Connect to
directly query another service's data, and no service may call the Spur Connect
API using another service's project credentials.

### 7.1 `services/auth` — The Gateway

**Owns:** User identities, credentials, sessions, tokens, OAuth clients.

**Data it touches:** `users` and `sessions` SQL tables, KV for rate limits and
revocation records — all via `BaasClient` using the auth project's credentials.

**Responsibilities:**
- All endpoints in §6.2
- Password hashing (Argon2id) and verification
- TOTP enrolment and verification
- JWT signing (EdDSA / Ed25519) and JWKS publication
- Refresh token rotation and revocation (stored as KV entries with TTL)
- OAuth 2.0 authorisation server (PKCE only)
- Rate limiting at the endpoint level (KV counters)
- Audit log writes for all auth events (NoSQL `audit_logs` collection)

**Must NOT:**
- Read or write any other service's data
- Implement business logic beyond authentication and identity
- Store any application data (orders, posts, files, etc.)

---

### 7.2 `services/api` — Business Logic API

**Owns:** All application domain data.

**Data it touches:** Application SQL tables and NoSQL collections via its own
`BaasClient` instance (separate project credentials from `services/auth`).

**Responsibilities:**
- Serve the main application API
- Verify incoming JWTs against the gateway's JWKS (locally, no gateway call per request)
- Enforce authorisation based on token scopes and user roles
- Enqueue jobs for workers via BullMQ or Spur Connect edge functions

**Must NOT:**
- Issue, refresh, or revoke tokens
- Implement login or registration flows
- Access `services/auth`'s SQL tables or KV namespace directly

---

### 7.3 `services/worker` — Background Workers

**Owns:** Async job processing.

**Responsibilities:**
- Consume jobs from BullMQ queues
- Send transactional emails (via a mail provider SDK — Resend / Postmark)
  or via `baas.functions.invoke('send-email').with({...}).call()`
- Run scheduled maintenance tasks (prune expired records, etc.)
- Authenticate outbound calls to the API using a service-level API key

**Must NOT:**
- Expose any HTTP endpoints (no user-facing traffic)
- Store tokens or credentials in job payloads
- Access `services/auth`'s data namespace

---

### 7.4 `apps/accounts-ui` — Login / Account UI

**Owns:** The browser-facing UI served at `accounts.yourdomain.com`.

**Responsibilities:**
- Login, registration, MFA, password reset, and account settings pages
- Calls only the gateway's own API — no direct calls to `services/api`
- Handles the OAuth consent screen
- May use `baas.auth` (Spur Connect auth module) for project-scoped UI sessions

**Must NOT:**
- Store tokens in `localStorage` — use `httpOnly` cookies via the gateway's
  cookie-issuing endpoints
- Implement any auth logic itself — it is purely a UI layer over the gateway

---

## 8. Authentication & Identity Protocol

### 8.1 Human Login Flow

```
Client
  │
  ├─ POST /auth/login { email, password }
  │
  │   ── If no MFA ──────────────────────────────────────────────
  │◄─ 200 { accessToken, refreshToken, expiresIn }
  │
  │   ── If MFA enrolled ────────────────────────────────────────
  │◄─ 202 { challengeId, type: "totp" }
  │
  ├─ POST /auth/mfa/verify { challengeId, code }
  │◄─ 200 { accessToken, refreshToken, expiresIn }
```

Tokens are returned in the response body **and** set as `httpOnly; Secure; SameSite=Strict`
cookies. Browser clients use the cookies. API clients use the response body.

### 8.2 OAuth / Third-Party App Flow

All OAuth flows must use **PKCE** (RFC 7636). The implicit flow is disabled.

```
App → GET /auth/oauth/authorize
        ?response_type=code
        &client_id=CLIENT_ID
        &redirect_uri=https://app.example.com/callback
        &scope=openid profile email
        &state=RANDOM_STATE
        &code_challenge=CODE_CHALLENGE
        &code_challenge_method=S256

User logs in at the gateway and grants consent.

Gateway → REDIRECT https://app.example.com/callback?code=AUTH_CODE&state=STATE

App → POST /auth/oauth/token
        { grant_type: "authorization_code",
          code, redirect_uri, code_verifier, client_id }
     ← 200 { access_token, refresh_token, id_token, expires_in }
```

### 8.3 Token Verification in Downstream Services

Services verify tokens locally — no round-trip to the gateway per request.

```typescript
// packages/utils/src/verifyToken.ts
import { createRemoteJWKSet, jwtVerify } from 'jose'

const JWKS = createRemoteJWKSet(
  new URL(`${process.env.GATEWAY_URL}/.well-known/jwks.json`)
)
// createRemoteJWKSet caches the JWKS and refreshes automatically

export async function verifyAccessToken(token: string) {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer:   process.env.GATEWAY_ISSUER,
    audience: process.env.SERVICE_NAME,
  })
  return payload // { sub, email, scope, exp, iat, ... }
}
```

Install this utility in every service. Never call the gateway on each request.

---

## 9. Session & Token Management

### 9.1 Access Token Lifecycle

Access tokens are **short-lived by design** (15 minutes). If one leaks, it has a
narrow validity window. Services do not need a revocation check on every request.

```
Issue → Use (0–15 min) → Expire
              ↓
        Client sends refresh token
              ↓
        New access token + new refresh token issued
        Old refresh token invalidated (rotation)
```

### 9.2 Refresh Token Rotation

Every use of a refresh token produces a new refresh token and invalidates the old one.
If a previously-used refresh token is replayed, the gateway treats it as a token theft
signal: **all sessions for that user are immediately revoked** and a security alert
email is sent.

### 9.3 Session Revocation

Revocation records are stored in the Spur Connect KV store with a TTL matching
the affected token's remaining lifetime. Services check the revocation list on
every request via `baas.kv.get(`revoked:${tokenId}`)`.

| Trigger                   | Effect                                                    |
|---------------------------|-----------------------------------------------------------|
| User logs out             | Refresh token revoked; access token expires naturally     |
| Password changed          | All sessions for the user revoked                         |
| Account disabled          | Revocation record added; all tokens return 401            |
| Suspected theft (replay)  | All sessions revoked + security alert email               |

---

## 10. Service-to-Service Communication

### 10.1 Trust Model

```
[ Browser / Mobile / Third-party App ]
                 │
                 ▼
     [ accounts gateway ]   ◄── sole identity authority
                 │  issues tokens
                 ▼
     [ api service ]  ──API key──►  [ worker service ]
```

### 10.2 Required Headers

Every internal HTTP call between services must include:

```
Authorization: Bearer <token>
X-Request-ID:  <uuid v4>       # for distributed tracing
X-Service-ID:  <service-name>  # identifies the calling service
```

### 10.3 Worker Authentication

The worker service authenticates to the API using a **long-lived API key** stored
in its environment. This key is issued manually from the admin panel and has the
scope `worker:internal`. It must be rotated every 90 days.

---

## 11. Security Policies

### 11.1 Password Hashing

All passwords are hashed with **Argon2id** before storage. No other algorithm is
acceptable. Plaintext passwords must never be logged, queued, or stored anywhere.

```typescript
import argon2 from 'argon2'

// Hash on registration
const hash = await argon2.hash(password, {
  type:        argon2.argon2id,
  memoryCost:  65536,   // 64 MB
  timeCost:    3,
  parallelism: 4,
})

// Verify on login
const valid = await argon2.verify(hash, password)
```

### 11.2 JWT Signing

Tokens are signed with **Ed25519** (EdDSA). RSA is not used — Ed25519 keys are
smaller, faster, and considered more robust against implementation errors.

```typescript
import { SignJWT, generateKeyPair } from 'jose'

// Key generation (run once, store private key in secrets)
const { privateKey, publicKey } = await generateKeyPair('EdDSA')

// Signing
const token = await new SignJWT({ sub: userId, scope: 'profile' })
  .setProtectedHeader({ alg: 'EdDSA', kid: process.env.JWT_KID })
  .setIssuer(process.env.GATEWAY_ISSUER)
  .setAudience(audience)
  .setExpirationTime('15m')
  .sign(privateKey)
```

### 11.3 Rate Limiting

Implemented via `@fastify/rate-limit` backed by Spur Connect KV.

| Endpoint                  | Limit per IP    | Limit per account |
|---------------------------|-----------------|-------------------|
| `POST /auth/login`        | 20 req / 15 min | 10 req / 15 min   |
| `POST /auth/register`     | 5 req / hour    | —                 |
| `POST /auth/refresh`      | 60 req / hour   | 30 req / hour     |
| `POST /auth/password/*`   | 5 req / hour    | 3 req / hour      |
| All other endpoints       | 300 req / min   | —                 |

Exceeding limits returns `429 Too Many Requests` with a `Retry-After` header.

Rate limit counters use `baas.kv.set(key, count, { ttl: windowSeconds })`.

### 11.4 Input Validation

Every endpoint validates its input against a Zod schema before any business logic
runs. Fastify's JSON Schema serialisation prevents leaking unexpected fields in
responses. Redirect URIs for OAuth must match a pre-registered allowlist exactly —
no wildcards, no substring matching.

### 11.5 Transport Security

- All public endpoints are HTTPS only. Nginx redirects HTTP → HTTPS (301).
- TLS 1.2 minimum; TLS 1.3 preferred.
- HSTS: `max-age=31536000; includeSubDomains; preload`
- All TLS certificates via Let's Encrypt, auto-renewed by Certbot.

### 11.6 Audit Logging

Every authentication event is written as a structured Pino log line **and** inserted
into the NoSQL `audit_logs` collection via Spur Connect:

```typescript
// Structured log (stdout → log aggregator)
logger.info({
  event:         'auth.login.success',
  userId,
  ip,
  requestId,
  outcome:       'success',
})

// Persistent audit record (queryable)
await baas.nosql('audit_logs').insertOne({
  event:    'auth.login.success',
  userId,
  ip,
  requestId,
  outcome:  'success',
  createdAt: new Date().toISOString(),
})
```

Audit logs are retained for 12 months.

### 11.7 Firewall Rules (UFW)

**VPS-1 (Edge):**
- Allow 80, 443 from anywhere
- Allow 22 from your IP only
- Deny everything else

**VPS-2 (App):**
- Allow all from VPS-1 private IP
- Allow 22 from your IP only
- Deny everything else from public internet

---

## 12. Data Flow Diagrams

### 12.1 Human Login (No MFA)

```
Browser
  │
  ├─ POST /auth/login ─────────────────────► Gateway (VPS-2:4000)
  │                                              │
  │                                        Zod validation
  │                                              │
  │                                    argon2.verify(hash)
  │                                    [hash fetched via baas.db("users").getById]
  │                                              │
  │                                    Sign JWT (Ed25519)
  │                                              │
  │                              Store refresh token: baas.kv.set(...)
  │                                              │
  │◄─ 200 { accessToken, refreshToken } ────────┘
  │
  ├─ GET /api/resource ──────────────────► API Service (VPS-2:4001)
  │   Authorization: Bearer <accessToken>        │
  │                                    jwtVerify vs JWKS cache
  │                                    baas.kv.get(`revoked:${tokenId}`)
  │                                              │
  │◄─ 200 { data } ──────────────────────────── │
```

### 12.2 Token Refresh

```
Client
  │
  ├─ POST /auth/refresh { refreshToken } ──► Gateway
  │                                              │
  │                              baas.kv.get(`refresh:${token}`) — valid?
  │                                              │
  │                              baas.kv.delete(`refresh:${oldToken}`)
  │                                              │
  │                              Issue new access + refresh tokens
  │                              baas.kv.set(`refresh:${newToken}`, ...)
  │                                              │
  │◄─ 200 { accessToken, refreshToken } ────────┘
```

### 12.3 OAuth Flow (Third-party App)

```
App redirects browser to GET /auth/oauth/authorize
                                     │
                             User logs in at gateway
                             Consent screen shown
                             User approves
                                     │
                  Browser redirected to app callback?code=AUTH_CODE
                                     │
App ──► POST /auth/oauth/token { code, code_verifier }
     ◄── 200 { access_token, id_token, refresh_token }
                                     │
App ──► GET /auth/userinfo (Bearer access_token)
     ◄── 200 { sub, email, name }
```

---

## 13. Environment & Configuration

### 13.1 Required Environment Variables

Each service has its own `.env.production` (never committed to git). Below are the
gateway's required variables. Each service's README lists its own.

```env
# ── Gateway Identity ──────────────────────────────────────────
GATEWAY_URL=https://accounts.yourdomain.com
GATEWAY_ISSUER=https://accounts.yourdomain.com
SERVICE_PORT=4000

# ── JWT Signing (keep private key off disk; inject via CI) ────
JWT_PRIVATE_KEY_BASE64=<base64-encoded Ed25519 private key JWK>
JWT_KID=2024-01              # key ID in JWKS
JWT_PREV_KID=                # previous key ID during rotation (can be blank)

# ── Token Lifetimes (seconds) ─────────────────────────────────
ACCESS_TOKEN_TTL=900
REFRESH_TOKEN_TTL=2592000

# ── Spur Connect (data layer) ─────────────────────────────────
BAAS_BASE_URL=https://bass-backend.onrender.com
BAAS_PROJECT_ID=<your-spur-connect-project-id>
BAAS_API_KEY=<your-spur-connect-api-key>

# ── Email ─────────────────────────────────────────────────────
MAIL_PROVIDER=resend          # or postmark
MAIL_API_KEY=re_xxxxxxxxxxxx
MAIL_FROM=noreply@yourdomain.com

# ── Security ──────────────────────────────────────────────────
CORS_ALLOWED_ORIGINS=https://yourdomain.com,https://app.yourdomain.com
COOKIE_SECRET=<32-byte random hex>
COOKIE_DOMAIN=.yourdomain.com

# ── Observability ─────────────────────────────────────────────
LOG_LEVEL=info
OTEL_SERVICE_NAME=auth-gateway
OTEL_EXPORTER_OTLP_ENDPOINT=http://VPS2-PRIVATE-IP:4318
```

### 13.2 `.env.example`

Every service must ship a `.env.example` with all keys listed (values blank or
with safe placeholder defaults). This is committed to git. The actual `.env.production`
is never committed.

### 13.3 Spur Connect Credentials Per Service

Each service gets its own Spur Connect project or at minimum its own API key with
scoped permissions. Services must never share API keys. Key rotation follows the
same pipeline procedure as JWT key rotation (see §13.4).

### 13.4 Key Rotation Procedure

1. Generate new Ed25519 key pair: `node infra/scripts/generate-jwk.mjs`
2. Update `JWT_PRIVATE_KEY_BASE64` in secrets; set old `JWT_KID` as `JWT_PREV_KID`
3. Set new `JWT_KID` to new key identifier
4. Deploy — the gateway will serve both keys in JWKS during the grace period
5. After 15 minutes (old token max lifetime), remove `JWT_PREV_KID`

For Spur Connect API key rotation, issue a new key in the Spur Connect dashboard,
update `BAAS_API_KEY` in GitHub Secrets, and redeploy. Revoke the old key after
a successful deploy.

---

## 14. Testing & Validation Requirements

### 14.1 Test Stack

| Tool                 | Version | Use                                                          |
|----------------------|---------|--------------------------------------------------------------|
| **vitest**           | 2.x     | Unit tests and integration tests                             |
| **supertest**        | latest  | HTTP-level integration tests against a live Fastify instance |

For integration tests, Spur Connect is mocked via a lightweight wrapper around
`BaasClient` — no real database containers are required. Set `BAAS_BASE_URL` to
a test-scoped Spur Connect project or use `vi.mock('@spurs-baas/sdk')`.

Run all tests:

```bash
npm test                       # all workspaces
npm --workspace services/auth test   # gateway only
```

### 14.2 Coverage Requirements

The gateway (`services/auth`) must maintain **≥ 90% code coverage**. All other
services must maintain **≥ 80%**.

| Test category     | What to cover                                              |
|-------------------|------------------------------------------------------------|
| Unit tests        | Token generation, Argon2 hashing, Zod schema validation    |
| Integration tests | Full login / logout / refresh / OAuth flows                |
| Security tests    | JWT algorithm confusion, PKCE bypass, refresh token replay |
| Rate limit tests  | 429 triggers at correct thresholds                         |

### 14.3 Pre-merge Checklist for Auth Changes

Before any PR touching `/services/auth/**` is merged:

- [ ] No secrets hardcoded or logged anywhere
- [ ] All new endpoints have Zod validation schemas
- [ ] Rate limiting applied to all new auth endpoints (KV-backed counters)
- [ ] Audit log emitted for all new auth events (Pino + NoSQL `audit_logs`)
- [ ] JWKS / token verification logic reviewed by a second engineer
- [ ] Integration tests added for any new flow
- [ ] `.env.example` updated if new variables were added

---

## 15. Error Handling Standards

### 15.1 Error Response Format

```json
{
  "error":             "invalid_credentials",
  "error_description": "The email or password is incorrect.",
  "request_id":        "550e8400-e29b-41d4-a716-446655440000"
}
```

OAuth endpoints follow RFC 6749 error codes (`invalid_client`, `access_denied`, etc.).

### 15.2 HTTP Status Code Conventions

| Code | When to use                                                     |
|------|-----------------------------------------------------------------|
| 200  | Success                                                         |
| 201  | Resource created (new user registered)                          |
| 202  | MFA challenge issued — awaiting verification                    |
| 400  | Malformed request / validation failure                          |
| 401  | Missing, invalid, or expired token                              |
| 403  | Valid token but insufficient scope                              |
| 404  | Resource not found (do not reveal whether a user exists)        |
| 409  | Conflict — email already registered                             |
| 422  | Semantically invalid input — weak password, bad redirect URI    |
| 429  | Rate limit exceeded                                             |
| 500  | Internal server error — never expose stack traces in production |
| 503  | Service temporarily unavailable                                 |

### 15.3 Error Recovery (Services Calling the Gateway)

```
401 Unauthorized
  └─ Token expired? → attempt one silent refresh
  └─ Refresh fails? → redirect user to login
  └─ No refresh available? → redirect user to login

403 Forbidden
  └─ Log denied scope
  └─ Return 403 to the caller with context — never retry silently

429 Too Many Requests
  └─ Read Retry-After header
  └─ Wait that duration, then retry once
  └─ If 429 again → surface error to user, do not loop

5xx
  └─ Exponential backoff + jitter (base 1s, cap 60s, max 5 retries)
  └─ After max retries → surface error, alert on-call if production
```

The Spur Connect SDK (`@spurs-baas/sdk`) implements automatic retry with
exponential backoff on 429 responses (up to 3 retries). Service code does not
need to re-implement this for BaaS calls.

---

## 16. Deployment & Operations

### 16.1 CI/CD Pipeline (GitHub Actions)

**On every PR** (`.github/workflows/ci.yml`):
1. `npm ci`
2. `npm run lint`
3. `npm run typecheck`
4. `npm test` (Spur Connect SDK mocked in tests)
5. `npm run build` (verify all packages compile)

**On merge to `main`** (`.github/workflows/deploy.yml`):
1. Run full CI suite
2. Build Docker images, tag with git SHA
3. SSH into VPS-2; write `.env.production` files from GitHub Secrets
4. `docker compose pull && docker compose up -d`
5. Run smoke tests against staging (or production if no staging)
6. Notify on failure

### 16.2 Zero-downtime Deploys

Docker Compose on a single VPS does not give you true zero-downtime by default.
Use this pattern:

```bash
# On VPS-2, the deploy script does:
docker compose up -d --no-deps --build gateway
# Nginx keeps routing to the old container until the new one is healthy
# Healthcheck: GET /health must return 200 within 10s, 3 retries
```

Nginx `upstream` block uses `least_conn` and checks `/health` before sending traffic.

### 16.3 Rollback

```bash
# Roll back to the previous image (tagged by git SHA)
docker compose down gateway
docker compose up -d gateway --image yourregistry/gateway:<previous-sha>
```

Every deploy tags images with the git SHA. Keep the last 5 images in the registry.

### 16.4 Monitoring & Alerts

| Signal                       | Tool                    | Alert threshold              |
|------------------------------|-------------------------|------------------------------|
| Login failure rate           | Prometheus + Grafana    | > 10% over 5 min             |
| 5xx rate on gateway          | Prometheus + Grafana    | > 1% over 5 min              |
| Spur Connect API latency p99 | Prometheus + Grafana    | > 2s over 5 min              |
| Disk usage on VPS-2          | Node exporter + Grafana | > 85%                        |
| TLS cert expiry              | Grafana / Certbot hook  | < 30 days                    |
| Refresh token theft detected | Application log alert   | Any occurrence → immediate   |

Alerts route to a Slack channel or PagerDuty (your choice) via Grafana alerting.

### 16.5 Health Check Endpoint

`GET /health` returns:

```json
{
  "status": "ok",
  "baas":   "ok",
  "uptime": 3600
}
```

The `baas` field is derived from a lightweight `baas.kv.get('_healthcheck')`
probe. If Spur Connect is unreachable, `baas` returns `"degraded"` and the
endpoint returns `503`. Nginx will stop routing new connections to a container
returning 503.

---

## 17. Contribution & Change Protocol

### 17.1 Branch Strategy

| Branch    | Purpose                                       |
|-----------|-----------------------------------------------|
| `main`    | Always deployable; protected                  |
| `feat/*`  | Feature branches — merged via PR              |
| `fix/*`   | Bug fixes — merged via PR                     |
| `chore/*` | Tooling, deps, config — merged via PR         |

Direct pushes to `main` are blocked. All changes go through a PR with at least one
review.

### 17.2 For Contributors

1. Read this file in full before working on anything in `/services/auth/`.
2. Label all PRs touching auth code with `auth-gateway`.
3. At least one reviewer must be security-familiar on every auth PR.
4. Never merge your own auth PR without a second approval.
5. Update `AGENTS.md` if your change adds a new endpoint, token type, service,
   or trust boundary.
6. Update `.env.example` for every new environment variable.
7. Do not add direct Postgres drivers, MongoDB clients, or Redis clients to any
   service. All data access goes through `@spurs-baas/sdk`.

### 17.3 Versioning This Document

This document is versioned with the codebase. Every meaningful change must be
recorded in the changelog below.

| Version | Date       | Author           | Summary                                          |
|---------|------------|------------------|--------------------------------------------------|
| 1.0.0   | YYYY-MM-DD | [YOUR_NAME]      | Initial version                                  |
| 1.1.0   | YYYY-MM-DD | [YOUR_NAME]      | Added full stack + infra detail                  |
| 1.2.0   | YYYY-MM-DD | [YOUR_NAME]      | Pinned all package versions; added setup.bat     |
| 1.3.0   | YYYY-MM-DD | [YOUR_NAME]      | Replaced Postgres/Redis/Drizzle with Spur Connect BaaS (`@spurs-baas/sdk`) |

---

*End of AGENTS.md*
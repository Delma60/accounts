// apps/accounts-ui/src/lib/api.ts
//
// ARCHITECTURE NOTE (per AGENTS.md §7.4):
//   - This file is used ONLY from Next.js Server Actions / API Route Handlers.
//   - It runs server-side so it can forward the httpOnly cookie jar with `credentials: 'include'`.
//   - The browser never calls the gateway directly — it calls /api/* routes in this Next.js app.
//   - Tokens are NEVER stored in localStorage or exposed to client JS.

import { GATEWAY_URL } from './env'

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

interface FetchOptions extends RequestInit {
  /** Forward incoming cookie header from the browser request (SSR / Server Actions) */
  cookieHeader?: string
}

async function gatewayFetch<T>(
  path: string,
  options: FetchOptions = {},
): Promise<T> {
  const { cookieHeader, ...fetchOpts } = options

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    ...(fetchOpts.headers ?? {}),
  }

  const res = await fetch(`${GATEWAY_URL}${path}`, {
    ...fetchOpts,
    headers,
    // Important: always send credentials so the gateway can set/read httpOnly cookies
    credentials: 'include',
    cache: 'no-store',
  })

  if (!res.ok) {
    let body: { error?: string; error_description?: string } = {}
    try {
      body = await res.json()
    } catch {
      // ignore parse failure
    }
    throw new ApiError(
      res.status,
      body.error ?? 'unknown_error',
      body.error_description ?? `HTTP ${res.status}`,
    )
  }

  // 204 No Content
  if (res.status === 204) return undefined as unknown as T

  return res.json() as Promise<T>
}

// ── Auth endpoint wrappers ────────────────────────────────────────────────────

export interface LoginSuccessResponse {
  accessToken: string
  refreshToken: string
  expiresIn: number
  tokenType: 'Bearer'
}

export interface MfaChallengeResponse {
  challengeId: string
  type: 'totp'
}

export interface RegisterResponse {
  user: {
    id: string
    email: string
    name?: string
    status: string
    mfaEnabled: boolean
    createdAt: string
    updatedAt: string
  }
  message: string
}

export const authApi = {
  register(body: { email: string; password: string; name?: string }, cookieHeader?: string) {
    return gatewayFetch<RegisterResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(body),
      cookieHeader,
    })
  },

  login(body: { email: string; password: string }, cookieHeader?: string) {
    // Returns LoginSuccessResponse (200) or MfaChallengeResponse (202)
    return gatewayFetch<LoginSuccessResponse | MfaChallengeResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(body),
      cookieHeader,
    })
  },

  logout(body?: { refreshToken?: string }, cookieHeader?: string) {
    return gatewayFetch<{ message: string }>('/auth/logout', {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
      cookieHeader,
    })
  },

  refresh(body?: { refreshToken?: string }, cookieHeader?: string) {
    return gatewayFetch<LoginSuccessResponse>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
      cookieHeader,
    })
  },

  mfaVerify(body: { challengeId: string; code: string }, cookieHeader?: string) {
    return gatewayFetch<LoginSuccessResponse>('/auth/mfa/verify', {
      method: 'POST',
      body: JSON.stringify(body),
      cookieHeader,
    })
  },

  mfaEnroll(cookieHeader?: string) {
    return gatewayFetch<{ secret: string; otpauthUrl: string; backupCodes: string[] }>(
      '/auth/mfa/enroll',
      { method: 'POST', body: JSON.stringify({}), cookieHeader },
    )
  },

  mfaActivate(body: { code: string }, cookieHeader?: string) {
    return gatewayFetch<{ message: string }>('/auth/mfa/activate', {
      method: 'POST',
      body: JSON.stringify(body),
      cookieHeader,
    })
  },

  forgotPassword(body: { email: string }, cookieHeader?: string) {
    return gatewayFetch<{ message: string }>('/auth/password/forgot', {
      method: 'POST',
      body: JSON.stringify(body),
      cookieHeader,
    })
  },

  resetPassword(body: { token: string; password: string }, cookieHeader?: string) {
    return gatewayFetch<{ message: string }>('/auth/password/reset', {
      method: 'POST',
      body: JSON.stringify(body),
      cookieHeader,
    })
  },

  userinfo(cookieHeader?: string) {
    return gatewayFetch<{
      sub: string
      email: string
      name?: string
      email_verified: boolean
    }>('/auth/userinfo', { cookieHeader })
  },
}
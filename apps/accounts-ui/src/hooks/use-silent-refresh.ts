'use client'
// apps/accounts-ui/src/hooks/use-silent-refresh.ts
//
// ARCHITECTURE NOTE (per AGENTS.md §7.4 + §9.1):
//   Tokens live in httpOnly cookies — JS cannot read them.
//   This hook calls the BFF /api/auth/refresh route on a timer that fires
//   slightly before the 15-minute access token window expires.
//   The BFF route forwards the request to the gateway and the gateway
//   rotates both cookies in-place. The browser never sees token values.

import { useEffect, useRef } from 'react'

const REFRESH_INTERVAL_MS = 13 * 60 * 1000 // 13 min — 2 min before 15 min expiry

export function useSilentRefresh() {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function refresh() {
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      })
      if (!res.ok) {
        // Refresh failed — the refresh token has likely expired or been revoked.
        // Redirect to login so the user can re-authenticate.
        if (res.status === 401 || res.status === 403) {
          window.location.href = '/login'
        }
      }
    } catch {
      // Network error — keep trying on next interval
    }
  }

  useEffect(() => {
    // Start the first refresh 13 minutes after mount
    timerRef.current = setInterval(refresh, REFRESH_INTERVAL_MS)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])
}
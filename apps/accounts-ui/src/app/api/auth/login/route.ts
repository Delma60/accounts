// apps/accounts-ui/src/app/api/auth/login/route.ts
//
// BFF pattern: this route runs on the Next.js server.
// It proxies the login request to the gateway and relays the httpOnly
// Set-Cookie headers back to the browser. Tokens NEVER reach client JS.

import { NextRequest, NextResponse } from 'next/server'
import { GATEWAY_URL } from '@/lib/env'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    const gatewayRes = await fetch(`${GATEWAY_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Forward real client IP for gateway rate limiting
        'X-Forwarded-For': req.headers.get('x-forwarded-for') ?? '',
        'X-Real-IP': (req as any).ip ?? '',
      },
      body: JSON.stringify(body),
      credentials: 'include',
    })

    const data = await gatewayRes.json()

    // Build the response, preserving the gateway HTTP status
    const response = NextResponse.json(data, { status: gatewayRes.status })

    // Relay all Set-Cookie headers from the gateway to the browser
    const setCookieHeader = gatewayRes.headers.getSetCookie?.() ?? []
    for (const cookie of setCookieHeader) {
      response.headers.append('Set-Cookie', cookie)
    }

    return response
  } catch {
    return NextResponse.json(
      { error: 'proxy_error', error_description: 'Unable to reach auth gateway.' },
      { status: 502 },
    )
  }
}
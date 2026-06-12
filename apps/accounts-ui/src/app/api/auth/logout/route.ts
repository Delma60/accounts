// apps/accounts-ui/src/app/api/auth/logout/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { GATEWAY_URL } from '@/lib/env'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const cookieHeader = req.headers.get('cookie') ?? ''

    const gatewayRes = await fetch(`${GATEWAY_URL}/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader,
      },
      body: JSON.stringify(body),
    })

    const data = await gatewayRes.json()
    const response = NextResponse.json(data, { status: gatewayRes.status })

    // Relay cookie-clear instructions from the gateway
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
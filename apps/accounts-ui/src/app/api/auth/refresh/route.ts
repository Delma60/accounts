// apps/accounts-ui/src/app/api/auth/refresh/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { GATEWAY_URL } from '@/lib/env'

export async function POST(req: NextRequest) {
  try {
    const cookieHeader = req.headers.get('cookie') ?? ''

    const gatewayRes = await fetch(`${GATEWAY_URL}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader,
      },
      // No body — refresh token comes from the forwarded httpOnly cookie
      body: JSON.stringify({}),
    })

    const data = await gatewayRes.json()
    const response = NextResponse.json(data, { status: gatewayRes.status })

    // Gateway will issue new rotated cookies
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
// apps/accounts-ui/src/app/api/auth/register/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { GATEWAY_URL } from '@/lib/env'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    const gatewayRes = await fetch(`${GATEWAY_URL}/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': req.headers.get('x-forwarded-for') ?? '',
      },
      body: JSON.stringify(body),
    })

    const data = await gatewayRes.json()
    return NextResponse.json(data, { status: gatewayRes.status })
  } catch {
    return NextResponse.json(
      { error: 'proxy_error', error_description: 'Unable to reach auth gateway.' },
      { status: 502 },
    )
  }
}
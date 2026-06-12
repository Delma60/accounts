// apps/accounts-ui/next.config.ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Strict mode for catching React issues early
  reactStrictMode: true,

  // All auth API calls proxy through the gateway — never expose tokens to the client
  // The gateway URL is set via NEXT_PUBLIC_GATEWAY_URL (read-only, public)
  // Sensitive operations go through Next.js API routes (BFF pattern) — not client fetch
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ]
  },
}

export default nextConfig
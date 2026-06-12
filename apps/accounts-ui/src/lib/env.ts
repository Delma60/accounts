// apps/accounts-ui/src/lib/env.ts
// NEXT_PUBLIC_ vars are safe to expose — they reference the gateway URL only.
// No tokens or secrets are ever stored client-side.


export const GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:4000'
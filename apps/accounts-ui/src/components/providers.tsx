'use client'
// apps/accounts-ui/src/components/providers.tsx

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { useState, type ReactNode } from 'react'

export function Providers({ children }: { children: ReactNode }) {
  // One QueryClient per browser session — not a module-level singleton
  // so server-side renders stay isolated between requests
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Token refresh on focus is handled by the silent refresh hook
            refetchOnWindowFocus: false,
            // Stale time of 5 minutes — profile data doesn't change often
            staleTime: 5 * 60 * 1000,
            retry: (failureCount, error: unknown) => {
              // Don't retry on 401/403 — those are auth errors, not transient
              if (error instanceof Error && 'status' in error) {
                const status = (error as { status: number }).status
                if (status === 401 || status === 403) return false
              }
              return failureCount < 2
            },
          },
        },
      }),
  )

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {process.env.NODE_ENV === 'development' && (
        <ReactQueryDevtools initialIsOpen={false} />
      )}
    </QueryClientProvider>
  )
}
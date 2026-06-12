"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useState, useEffect, type ReactNode } from "react";
import { BaasClient } from "@spurs-baas/sdk";
import { createBaasClient } from "@app/utils";
// Module-level singleton — one wake-up per browser session
let _woken = false;

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            staleTime: 5 * 60 * 1000,
            retry: (failureCount, error: unknown) => {
              if (error instanceof Error && "status" in error) {
                const status = (error as { status: number }).status;
                if (status === 401 || status === 403) return false;
              }
              return failureCount < 2;
            },
          },
        },
      }),
  );

  useEffect(() => {
    if (_woken) return;
    _woken = true;

    // Fire-and-forget — don't block rendering. The backend only needs to be
    // warm by the time the user submits a form (login, register, etc.).
    console.log(process.env.NEXT_PUBLIC_BAAS_BASE_URL)
    const baas = new BaasClient({
      projectId: process.env.NEXT_PUBLIC_BAAS_PROJECT_ID ?? "",
      apiKey: process.env.NEXT_PUBLIC_BAAS_ANON_KEY ?? "",
      // baseUrl: process.env.NEXT_PUBLIC_BAAS_BASE_URL ?? "",
    });

    createBaasClient

    void baas.wakeUp({
      onAttempt: (n) => console.debug(`[BaaS] wake-up attempt ${n}`),
    });
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {process.env.NODE_ENV === "development" && (
        <ReactQueryDevtools initialIsOpen={false} />
      )}
    </QueryClientProvider>
  );
}

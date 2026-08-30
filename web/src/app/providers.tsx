import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { JSX, ReactNode } from 'react';
import { ApiError } from '../shared/api/http-client.js';
import { ToastProvider } from '../shared/ui/index.js';

// One QueryClient for the app. Server state lives here; local UI state stays in components.
// Retry generously on connection/5xx failures so a brief API blip — most commonly the dev
// `tsx watch` restart window, which takes a few seconds to rebind :4000 — self-heals instead of
// pinning a dead-end error card. A 4xx is a real client error (bad request, not found): never retry.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
        return failureCount < 4;
      },
      retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 5_000),
    },
  },
});

export function AppProviders({ children }: { children: ReactNode }): JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

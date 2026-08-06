/**
 * The ONE place the web app reads build-time config (§6.5 mirrored on the frontend).
 * In dev, requests go to `/api` and Vite proxies them to Express; override with VITE_API_BASE_URL.
 */
export const config = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? '/api',
} as const;

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Dev proxy: the app calls `/api/*` and Vite forwards to the Express server, so there is one
// origin in dev and no CORS dance. In prod the SPA is served statically and points at the API URL.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});

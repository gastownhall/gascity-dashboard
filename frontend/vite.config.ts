import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Single-port deploy: dev server proxies /api → backend at 8081, prod
// build is served by the backend's express.static. The frontend NEVER
// needs to know about cross-origin — everything is same-origin both in
// dev and prod, which keeps the Host-allowlist + Origin check + CSP
// simple.
const BACKEND_TARGET = 'http://127.0.0.1:8081';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: BACKEND_TARGET,
        // changeOrigin rewrites the *Host* header to match the backend's
        // host:port so the Host-allowlist (127.0.0.1, localhost) passes.
        changeOrigin: true,
        // changeOrigin does NOT rewrite the *Origin* request header — that
        // still arrives as http://127.0.0.1:5174 (Vite's own origin) and
        // would 403 against the backend's originCheck allow-list of
        // {http://127.0.0.1:8081, http://localhost:8081}. Rewrite it
        // explicitly so dev write requests (POST/PATCH/DELETE) clear the
        // allow-list. In prod the frontend is served by express.static,
        // so the browser sends Origin: http://127.0.0.1:8081 natively and
        // this code path doesn't apply (gascity-dashboard-oi7).
        configure(proxy) {
          proxy.on('proxyReq', (proxyReq) => {
            if (proxyReq.hasHeader('origin')) {
              proxyReq.setHeader('Origin', BACKEND_TARGET);
            }
          });
        },
      },
      // Browser supervisor client transport. The dashboard backend forwards
      // this prefix without parsing supervisor DTOs, avoiding cross-origin
      // dev setup while keeping GC resources off dashboard /api routes.
      '/gc-supervisor': {
        target: BACKEND_TARGET,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    emptyOutDir: true,
  },
});

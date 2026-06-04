import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Single-port deploy: dev server proxies /api → backend at 8081, prod
// build is served by the backend's express.static. The frontend NEVER
// needs to know about cross-origin — everything is same-origin both in
// dev and prod, which keeps the Host-allowlist + Origin check + CSP
// simple.
// DEV_BACKEND_TARGET lets an isolated worktree stack proxy to its own
// backend port (pair with `vite --port <n>`), so the snap harness can
// drive it via SNAP_BASE without touching the primary :5174/:8081 pair.
const DEFAULT_BACKEND_TARGET = 'http://127.0.0.1:8081';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

// The backend binds 127.0.0.1 only and must never be exposed, so a custom dev
// proxy target must still resolve to loopback. Validate at config load — a
// non-loopback or malformed DEV_BACKEND_TARGET fails loudly here rather than
// silently proxying dev traffic off-host.
function resolveBackendTarget(): string {
  const raw = process.env.DEV_BACKEND_TARGET;
  if (raw === undefined) return DEFAULT_BACKEND_TARGET;
  let hostname: string;
  try {
    hostname = new URL(raw).hostname;
  } catch {
    throw new Error(`DEV_BACKEND_TARGET is not a valid URL: ${JSON.stringify(raw)}`);
  }
  // URL parsing wraps IPv6 hosts in brackets ([::1]); strip them before compare.
  const normalized = hostname.replace(/^\[|\]$/g, '');
  if (!LOOPBACK_HOSTS.has(normalized)) {
    throw new Error(
      `DEV_BACKEND_TARGET must resolve to loopback (127.0.0.1, localhost, or ::1); got ${JSON.stringify(hostname)}`,
    );
  }
  return raw;
}

export const BACKEND_TARGET = resolveBackendTarget();

interface ProxyRequest {
  hasHeader(name: string): boolean;
  setHeader(name: string, value: string): void;
}
type BackendDevProxy = {
  on(event: 'proxyReq', listener: (proxyReq: ProxyRequest) => void): void;
};

export function configureBackendDevProxy(proxy: BackendDevProxy): void {
  proxy.on('proxyReq', (proxyReq) => {
    if (proxyReq.hasHeader('origin')) {
      proxyReq.setHeader('Origin', BACKEND_TARGET);
    }
  });
}

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
        configure: configureBackendDevProxy,
      },
      // Browser supervisor client transport. The dashboard backend forwards
      // this prefix without parsing supervisor DTOs, avoiding cross-origin
      // dev setup while keeping GC resources off dashboard /api routes.
      '/gc-supervisor': {
        target: BACKEND_TARGET,
        changeOrigin: true,
        // Same origin rewrite as /api. Supervisor browser mutations still hit
        // the dashboard backend's originCheck before the transport proxy strips
        // Origin and forwards to gc.
        configure: configureBackendDevProxy,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    emptyOutDir: true,
  },
});

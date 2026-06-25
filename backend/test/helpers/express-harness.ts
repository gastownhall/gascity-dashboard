// Shared harness for focused middleware tests (security.ts, csrf.ts).
//
// These middleware guard the bind/Host/Origin/CSRF invariants, so the tests
// must drive them through a real express app — a hand-mocked req/res would not
// prove the middleware behaves when wired the way app.ts wires it. The host
// allowlist in particular keys off the raw `Host` header, which the WHATWG
// fetch (undici) forbids callers from setting. `node:http.request` lets us set
// `Host` (and any method/Origin) verbatim, so we drive the app with it instead
// of `fetch`.

import http, { type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

export interface RunningApp {
  url: string;
  close(): Promise<void>;
}

/** Start an express app the caller has configured, bound to 127.0.0.1:0. */
export async function startApp(configure: (app: express.Express) => void): Promise<RunningApp> {
  const app = express();
  configure(app);
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Run `fn` against a freshly configured app and always tear the server down. */
export async function withApp<T>(
  configure: (app: express.Express) => void,
  fn: (app: RunningApp) => Promise<T>,
): Promise<T> {
  const app = await startApp(configure);
  try {
    return await fn(app);
  } finally {
    await app.close();
  }
}

// Fail-fast ceiling for a single raw request. These are localhost middleware
// tests that resolve in single-digit milliseconds; if one blows past this, a
// middleware branch has stalled and we want the runner to fail with a clear
// error rather than hang until the whole suite times out.
const RAW_REQUEST_TIMEOUT_MS = 5_000;

export interface RawRequestOptions {
  method?: string;
  /** Verbatim request headers, including normally-protected ones like `Host`. */
  headers?: Record<string, string>;
  /** Override the {@link RAW_REQUEST_TIMEOUT_MS} fail-fast ceiling. */
  timeoutMs?: number;
}

export interface RawResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

/**
 * Issue a raw HTTP request that can carry an arbitrary `Host`/`Origin` header.
 * `fetch` cannot set `Host`, which is exactly the header the DNS-rebinding
 * defense inspects, so the security tests rely on this.
 */
export function rawRequest(url: string, options: RawRequestOptions = {}): Promise<RawResponse> {
  const target = new URL(url);
  const { method = 'GET', headers = {}, timeoutMs = RAW_REQUEST_TIMEOUT_MS } = options;
  return new Promise<RawResponse>((resolve, reject) => {
    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        method,
        headers,
      },
      (res) => {
        // A mid-stream socket error must reject, not leave the request dangling
        // on a promise that never settles (the runner would hang on it).
        res.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          clearTimeout(timer);
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    // Fail fast on a stalled middleware branch: destroy the request, which
    // surfaces through the 'error' handler below with a clear timeout reason.
    const timer = setTimeout(() => {
      req.destroy(new Error(`rawRequest timed out after ${timeoutMs}ms: ${method} ${url}`));
    }, timeoutMs);
    req.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    req.end();
  });
}

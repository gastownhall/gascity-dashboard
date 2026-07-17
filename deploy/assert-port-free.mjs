// Refuse to start when the address the backend binds is already held.
//
// This asks the kernel the exact question ExecStart is about to ask — "can I
// bind HOST:PORT?" — rather than pattern-matching `ss` output. That is not a
// style preference; no `ss` filter can answer it correctly:
//
//   - `sport = :PORT` matches the port on EVERY interface. `tailscale serve`
//     holds <tailnet-ip>:PORT to proxy INTO 127.0.0.1:PORT, so this aborted a
//     start whose own address was free — it strangled its own upstream.
//   - `src 127.0.0.1:PORT` fixes that, but misses `0.0.0.0:PORT` and dual-stack
//     `[::]:PORT`, which DO prevent the bind. The unit then starts, node dies
//     EADDRINUSE, and Restart=on-failure turns a clean abort into a crash-loop.
//   - A dual-stack `[::]:PORT` conflicts; a v6only one does not. `ss` renders
//     them differently (`*:PORT` vs `[::]:PORT`) but its FILTERS match both
//     identically, and it never reports IPV6_V6ONLY. So a filter cannot
//     separate them, and parsing its rendering is version-dependent guesswork.
//
// A bind probe is correct for every one of those cases by construction, and it
// stays correct if the kernel's rules change. Verified both directions in
// backend/test/deploy-unit.test.ts against real units.
//
// The probe closes the socket before exiting; a listening socket with no
// accepted connections leaves no TIME_WAIT to block the real bind. The gap
// between probe and ExecStart is inherently racy — that race is identical to
// the `ss` check this replaces, and losing it costs a crash-loop, not a
// silent start.

import { createServer } from 'node:net';

const [host, portArg] = process.argv.slice(2);

if (!host || !portArg) {
  console.error('usage: assert-port-free.mjs <host> <port>');
  process.exit(2);
}

const port = Number(portArg);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`gas-city-dashboard: PORT must be an integer 1-65535, got: ${portArg}`);
  process.exit(2);
}

const server = createServer();

server.once('error', (err) => {
  const code = /** @type {NodeJS.ErrnoException} */ (err).code ?? 'unknown';
  if (code === 'EADDRINUSE') {
    console.error(
      `gas-city-dashboard: ${host}:${port} is already bound — stop whatever holds it ` +
        `(ss -tlnp 'sport = :${port}' shows every listener on this port, including ` +
        `0.0.0.0 and [::] wildcards that conflict with a ${host} bind)`,
    );
  } else {
    console.error(`gas-city-dashboard: cannot bind ${host}:${port} — ${code}`);
  }
  process.exit(1);
});

server.listen(port, host, () => {
  server.close(() => process.exit(0));
});

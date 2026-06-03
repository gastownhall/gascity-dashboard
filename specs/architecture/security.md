# Security — posture

This file enumerates the security decisions the dashboard makes and the **test invariants** that block merge.

The product runs on the operator's host, on `127.0.0.1`, with no auth. That is **not** a free pass — multi-user POSIX hosts share `127.0.0.1` across all local users, prompt-injection in agent mail can drive XSS, and the dashboard executes whitelisted shell commands. Each section below names the defense and how to verify it.

## Target network posture

The target architecture has two browser-visible API classes:

- GC-owned resources come from the GC supervisor API through a generated
  browser client.
- Dashboard-local resources come from the dashboard service under `/api/*`.

Standalone development may route supervisor `/health` and `/v0/*` through the
dashboard service under `/gc-supervisor/*` as a transport-only proxy so one
SSH-forwarded port is enough. That proxy is not a security or DTO boundary: it
forwards bytes and headers and does not inspect, validate, strip, cache, or
rename supervisor payloads.

## Dashboard service network posture

- **Bind 127.0.0.1 only.** Not `0.0.0.0`. Enforced by `backend/src/config.ts`: `HOST` is ignored unless it is already `127.0.0.1`, and `backend/src/server.ts` binds `config.bindHost`. The systemd unit further restricts via `RestrictAddressFamilies=AF_UNIX AF_INET`.
- **Host header allowlist** (DNS rebinding defense). `middleware/security.ts::hostHeaderAllowlist`. Allowed: `127.0.0.1`, `localhost` (with optional port). Anything else → **HTTP 421 Misdirected Request**.
- **Origin header check** on dashboard-service state-changing endpoints. Must be `http://127.0.0.1:<port>` or `http://localhost:<port>`. Anything else → **HTTP 403**.
- **IPv6 posture**: Node's `app.listen('127.0.0.1', …)` binds IPv4 only, so `::1` is naturally refused.
- **CSP `connect-src` names the chosen transport.** If the browser calls the
  supervisor directly, include the supervisor origin explicitly. If standalone
  mode uses the transport-only proxy, `connect-src 'self'` remains sufficient.

### Invariants

```
curl -sH 'Host: evil.com' http://127.0.0.1:8081/api/health    # → 421
curl -sX POST -H 'Origin: http://evil.com' http://127.0.0.1:8081/api/client-errors  # → 403
```

## Frame / content type

- `X-Frame-Options: DENY`
- `Content-Security-Policy: default-src 'self'; script-src 'self' 'sha256-...'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`

## CSRF

Double-submit cookie pattern (`middleware/csrf.ts`). Token generated per boot,
surfaced as a `gascity_admin_csrf` cookie (`SameSite=Strict`, non-HttpOnly),
echoed by the frontend as `X-CSRF-Token` on every dashboard-service
POST/PATCH/DELETE.

The target dashboard-service write surface is local-only: client-error
telemetry, maintainer `gh` actions, and any local audit/control endpoints. GC
mutations should move to the supervisor API and use the supervisor's own
browser-safe mutation/auth/header model. Do not keep a dashboard-server GC
write route merely to reuse the dashboard CSRF middleware.

Why not `csurf`: the canonical package is deprecated; rolling a minimal double-submit pattern is reasonable here, and the Host + Origin checks do the heavy lifting. CSRF is the third belt.

### Invariant

```
curl -sX POST http://127.0.0.1:8081/api/client-errors -H 'Host: 127.0.0.1' -H 'Origin: http://127.0.0.1:8081'
# → 403 {"error":"Missing CSRF token","kind":"csrf"}
```

## Shell-exec posture

Every privileged invocation routes through `backend/src/exec.ts`. **No general-purpose exec helper exists.**

- **Target enum whitelist** of allowed commands: `git` evidence commands and
  `gh` maintainer reads/actions only. `gc` subprocesses are not part of the
  dashboard service exec surface.

  Bead close with operator reason moved to the generated supervisor client
  after `GC-10`; agent nudge moved after `GC-11`; agent prime/composed-prompt
  reads moved after `GC-12`. Those subprocess paths are not part of the exec
  surface.

  *Peek is no longer in this list:* architect addendum td-wisp-ijk7g (mechanic td-wisp-e1v14) confirmed peek is served by gc supervisor's `GET /v0/city/{name}/session/{id}/transcript` HTTP endpoint as structured turns. The current implementation fetches the transcript through the generated browser supervisor client and renders it as escaped text; no dashboard server route or `subprocess.spawn` is involved.

- **Param schemas** enforced before any privileged call:
  - Bead id: `^(td|th|jt)-[a-z0-9-]{3,32}$`
  - Session id: `^(gc|td|th|[a-z]{4})-[a-z0-9-]{1,32}$` (case-sensitive, no `/i`; validated via the shared `SESSION_ID_RE` in `lib/sessionId.ts` for run/session linking). The `[a-z]{4}` alternation admits city-scoped prefixes (e.g. `fddc-*`) whose codes are derived per-deployment and can't be enumerated here; the lowercase-only, hyphen-and-alphanumeric body keeps the gate strict.
  - Agent alias: `^[a-z][a-z0-9_./-]{1,63}$`
- **Spawn options**:
  - `shell: false` — non-negotiable. No `sh -c`, no command injection vectors.
  - `env: cleanEnv()` — inherited env stripped. The child receives `PATH` from `ADMIN_PATH` when configured, otherwise a fixed local-safe search path; `HOME`; `LANG=C.UTF-8`; `NO_COLOR=1`; and `GITHUB_TOKEN` only when the dashboard process explicitly has one for `gh` reads.
  - `stdio: ['ignore', 'pipe', 'pipe']` — child can't block on stdin prompts.
- **Resource limits**: per-exec timeout 10–15 s; output cap 100 KB (truncates + kills child); concurrency cap of 4 parallel via in-process semaphore.
- **Audit log**: every exec writes a `{type: 'dashboard.exec', endpoint, parsed_args, exit_code, duration_ms}` row to `.gc/events.jsonl` (durable channel; survives dolt-hq corruption).

### Invariant

```
curl -s http://127.0.0.1:8081/gc-supervisor/v0/city/test-city/session/$(printf "'; rm -rf /")/stream …
# → 400 {"error":"invalid session id","kind":"validation"}
```

The literal arguments never reach a shell; even if they did, `shell: false` would refuse to interpret them.

## XSS posture — LLM-controlled content

Everything rendered in the UI that originated outside the dashboard (mail bodies, bead descriptions, peek output, agent state strings) is **TEXT, NOT HTML**.

- React's default escaping is the friend. `{content}` not `dangerouslySetInnerHTML`. No `innerHTML`, no `document.write`, no `eval`, no `Function()` anywhere in the frontend.
- Transcript output: fetched from the supervisor transcript endpoint and rendered as text. Client converts `ansi_up` output into React nodes before rendering, so transcript colour spans are still escaped component output rather than injected HTML.
- Mail bodies + bead descriptions render in `<pre>` with full text escaping.

### Banner

The peek modal carries a banner: *"Content is agent-generated and may contain misleading instructions."* Mitigates prompt-injection-in-content for the human reading it. Banner copy and presentation defer to `DESIGN.md` for status-presentation voice and the "States have words" rule.

### Invariant

```
# Mail body containing <script>alert(1)</script>
# Rendered in the UI → escaped to '&lt;script&gt;alert(1)&lt;/script&gt;' as text. No script execution.
```

## Identity-switching for mail (Phase B)

Target state: mail read/send identity is enforced by the supervisor API
contract and generated client types. The dashboard frontend must still render a
visible "Viewing as <agent>" banner and must not create a client-side "send as
other" path.

Current posture keeps mail reads and sends on the generated supervisor client:

- Mail list/thread reads use the generated supervisor client directly in the
  browser. The browser's "viewing as" state filters generated `Message`
  objects in memory; there is no dashboard read router or dashboard mail-read
  DTO.
- Compose sends use the generated supervisor `POST /v0/city/{cityName}/mail`
  client directly in the browser with the operator wire identity
  `from: "human"` and the supervisor mutation header. There is no dashboard
  mail-send router or dashboard mail-send DTO.

Frontend renders a visible "Viewing as <agent>" banner with colour; the compose-from field is greyed when viewing-as ≠ the operator so the constraint is visible *before* the user tries.

**Audit log** (`audit.ts`): mail no longer passes through the dashboard
service. Mail-send audit/event semantics are owned by the supervisor API; the
dashboard service only records dashboard-local writes.

No persistent client-side caching of mail under as-identity (`localStorage`,
IndexedDB, or durable caches). Generated-client query caches must key by
identity and stay in memory.

## Kill switch

```
ADMIN_DASHBOARD_DISABLED=1
```

`server.ts` checks this env at boot and refuses to bind the listener. `process.exit(0)`. Also enforceable via systemd `Environment=ADMIN_DASHBOARD_DISABLED=1`.

## What's NOT in v0

- Per-user POSIX permission gate: `127.0.0.1` is shared across all local users on the machine. v1 may switch to a Unix-domain socket with `0600` + os-owner ACL. v0 limitation: trust the host.
- No rate-limiting beyond the in-process semaphore. v1 may add per-IP throttle on the audit log path.
- No TLS — same-machine loopback only.
- No request signing beyond CSRF.

Anything beyond v0 lands as a separate bead. v0 deliberately ships the security floor that the architect + security_researcher named as merge-blocking — not the full enterprise stack.

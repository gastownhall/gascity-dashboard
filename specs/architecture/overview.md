# Architecture — gas-city-dashboard

> Engineer's-eye summary of decisions that affect implementation. For the product framing, read the [product spec](../requirements/product.md); for the visual register, read [`DESIGN.md`](../../DESIGN.md), the binding visual contract at the repo root. The architectural shape (the security model, the shared DTO contract, the systemd separation from `gc-supervisor`) is inherited from the [Wldc4rd/citadel](https://github.com/Wldc4rd/citadel) fork and remains intentional here.

## Architecture target: direct supervisor for GC-owned data

This repository is temporary: the intended end state is to fold this dashboard
back into `gastownhall/gascity` as the replacement for the existing
`gc dashboard`. That target changes the ownership boundary:

- The **browser** should call the GC supervisor API directly for every
  GC-owned resource the supervisor can expose, using a generated OpenAPI client.
- The **dashboard service** should own only local/non-supervisor capabilities:
  static hosting, runtime config, `git`/`gh` evidence, local build logs,
  host/process/dolt-noms health, client-error telemetry, and audit rows.
- Missing GC data or writes are upstream supervisor API gaps, tracked in
  [`../gc-supervisor-api-gaps.md`](../gc-supervisor-api-gaps.md). Do not create
  permanent dashboard-server GC facades to compensate.
- A same-origin supervisor proxy is acceptable for standalone development, CSP,
  or SSH forwarding, but only as a transport relay. In this repo the proxy is
  mounted at `/gc-supervisor/*` and forwards supervisor `/health` plus `/v0/*`.
  It must not parse, validate, map, strip, cache, or rename supervisor DTOs.

Current code still contains a dashboard-server GC mirror layer. The migration
plan to delete it lives in
[`../plans/direct-supervisor-client-migration.md`](../plans/direct-supervisor-client-migration.md).

## Stack: TypeScript end-to-end

- Backend: Node 22.13+ + Express + TypeScript.
- Frontend: React 18 + Vite + TypeScript + Tailwind. Self-hosted Inter Variable.
- **Generated supervisor client**: GC-owned browser surfaces use generated
  supervisor OpenAPI types/client directly.
- **Shared DTOs**: `shared/` workspace package (`gas-city-dashboard-shared`)
  remains for dashboard-owned service DTOs and UI/module contracts. It should
  not mirror supervisor wire shapes that the generated client already owns.

Rejected alternatives:

- **Python + FastAPI** — deploy messier (venv vs system), no shared types, slower to build this shape.
- **Go** — wrong coupling direction (admin tool shouldn't carry gc-the-orchestrator's lang dep).
- **Permanent dashboard-server supervisor facade** — rejected for the target
  architecture. It duplicates the supervisor contract and makes this dashboard
  harder to fold back into `gascity`.

## Real-time: direct supervisor streams, proxy only for transport

The supervisor exposes SSE at `/v0/city/{name}/events/stream` and session
streams under the supervisor API. Target behavior is to consume those streams
through the generated/browser supervisor surface when the browser can reach the
supervisor origin.

When standalone development needs one forwarded port or a stricter CSP,
same-origin stream proxying remains allowed as a transport-only compatibility
path:

- CSP can stay `connect-src 'self'`.
- Remote/SSH-forwarded development can expose one browser-visible port.
- The proxy forwards `Last-Event-ID`, backpressure, heartbeat, and disconnects.
- The proxy does **not** inspect event payloads or own invalidation semantics.

Migration flow:

- City event consumers and selected-session stream consumers now use supervisor
  EventSource URLs through the transport path.
- If a same-origin proxy remains, mount it on an explicitly transport-named
  path such as `/gc-supervisor/*`, not as a dashboard DTO endpoint.
- Agents, Beads, Runs, and Formula Run Detail subscribe to supervisor event
  prefixes and refresh generated-client queries directly.
- Belt-and-braces still applies: every panel has a manual Refresh button for the tab-sleep / laptop-close case.

## Activity + Health (Phase C — ✅ shipped)

- **Activity** (`/activity`): split ownership. Supervisor activity/events come
  from the generated supervisor client. Local repository evidence stays on
  `/api/git/commits?view=<enum>` because it shells out to `git` against the
  dashboard host repo.
- **Health** (`/health`): split ownership. Supervisor health comes from the
  generated supervisor client. Host/process/dolt-noms health stays on the
  dashboard service because it reads the local process and filesystem.

## Dolt-noms ring buffer

The ring buffer is wired in `backend/src/routes/dolt.ts`: 144 slots, 10-minute
sampling cadence, and explicit unavailable states. The sampler reads the
recursive byte size of `<GC_CITY_PATH>/.dolt/noms`. When `GC_CITY_PATH` is
unset, relative, missing, not a directory, or the sample fails, the endpoint
returns `available: false` with a concrete `reason` instead of fake zeros. The
Health page renders that reason directly so operators can fix configuration
without digging through code.

## Transcript peek is supervisor HTTP

`GET /v0/city/{name}/session/{id}/transcript` returns structured JSON with
`turns: [{role, text}, ...]`. Target behavior is to fetch it through the
generated supervisor client and render it as escaped React text.

Security rule:

- Do not render transcript content as HTML.
- If ANSI color is preserved, convert to React nodes rather than
  `dangerouslySetInnerHTML`.
- Any sanitization needed for terminal control characters belongs in a shared
  frontend-safe rendering utility, not in a server-only GC DTO adapter.

## Deploy: systemd user unit (NOT `gc [[services]]`)

Three load-bearing reasons (per `security_researcher` td-wisp-eb0pn + `senior_developer` td-wisp-uvmru):

1. **Adoption-as-symmetry is a smell.** The Services card on the gc dashboard is correctly empty for this city.
2. **`[[services]]` is underexercised.** Admin dashboard is too operator-critical to be the first adopter of an untested lifecycle primitive.
3. **Inverted dependency.** gc-managed services restart with the gc-supervisor — but the dashboard is _exactly what the operator wants open when gc is misbehaving_. Dashboard must outlive supervisor outages.

systemd is boring, well-understood, and `journalctl`-debuggable. `ExecStartPre` includes a port-in-use check (`senior_developer` gotcha #5). Revisit `[[services]]` in v1+ when it has battle-tested adopters elsewhere.

## Process model

```
   operator (browser)
        ├── generated supervisor client → gc supervisor /v0/*
        │
        │  same-origin HTTP :8081 for dashboard-local APIs
        ▼
   ┌──────────────────────┐
   │  Express server      │  ← single process, supervised by systemd
   │  - local /api/*      │
   │  - SPA at /          │  (express.static, immutable cache on hashed assets)
   │  - /gc-supervisor/*  │  (transport-only supervisor proxy)
   │  - Audit → events.jsonl
   └──────────┬───────────┘
              │
              └── spawn() → git / gh only       — whitelisted local evidence
```

## Stateful Components

This dashboard is a single-node, loopback-only operator tool. Horizontal
scaling is outside the current product model, but the stateful parts are
deliberately isolated so a future multi-instance design has clear seams:

- `backend/src/snapshot/cache.ts` owns `SourceCache` instances for the ambient
  snapshot. Multi-instance deployment would move cache state to Redis or another
  shared cache with per-source TTLs.
- `backend/src/maintainer/sse.ts` owns the in-process `Set` of connected
  maintainer SSE clients. Multi-instance deployment would use a shared event
  broker so every browser sees refresh events regardless of which process holds
  its connection.
- `backend/src/exec-core.ts` owns the subprocess semaphore that caps privileged
  command concurrency. Multi-instance deployment would need a distributed lock
  or queue if the cap is meant to apply across processes.
- `backend/src/maintainer/slung-state.ts` serializes writes through a module
  write chain around one JSON file. Multi-instance deployment would replace it
  with a transactional store or a lock-backed file writer.
- Generated supervisor-client query caches belong in the browser data layer.
  The dashboard service should not own per-supervisor-resource caches after the
  direct-client migration.
- `backend/src/middleware/csrf.ts` owns the boot-scoped double-submit token.
  Multi-instance deployment would need shared token material or sticky sessions.

Timers are lifecycle-managed through the `DashboardRuntime` returned by
`createDashboardApp()`: the dolt-noms sampler and maintainer refresher start
and stop with the process wrapper instead of hidden module startup.

## Trust boundaries

- **Browser ↔ gc supervisor**: generated OpenAPI client for GC-owned resources.
  In standalone mode this may be direct to the supervisor origin or through a
  transport-only same-origin proxy.
- **Browser ↔ dashboard service**: same-origin, Host-allowlist, Origin check,
  CSP, CSRF on dashboard-service writes. See `security.md`.
- **Dashboard service ↔ shell (`git`/`gh`)**: whitelisted commands only,
  `shell: false`, clean env, param schemas. See `security.md`.
- **Dashboard service ↔ gc supervisor**: transitional only or transport-only.
  Do not add new permanent dashboard DTO routes for GC-owned resources.

## Phasing

The first-party views ship in three milestones. Each milestone has an acceptance gate:

- **Phase A (this commit)** — skeleton + Agents view + Beads view. _Gate_: the operator can identify any session's state + peek tmux content without a shell; can see filtered beads + claim/close from the browser.
- **Phase B** — Mail with identity-switching (view-as-X, sends-as-operator via separate router). _Gate_: the operator can read any agent's thread cross-agent; verify every send logs `actor=stephanie`.
- **Phase C** — Health (process + dolt-noms 24 h trend) + SSE wiring. _Gate_: the operator can spot the refinery's memory pressure trend without terminal.

Internal tool — the "anti-scope-reduction reflex" doesn't apply here. The views are loosely coupled; phasing is logical build order, not feature cuts.

## Reversibility

Stop the systemd unit and drop the repo. No persistent state to clean up. The audit log entries written to `.gc/events.jsonl` are read-only signal and won't break gc itself.

## What's deferred

- **PIN-quick-path for parent mode** is not this project (different bead).
- **Per-event-class notification opt-out** is not this project.
- **TanStack Table** — premature dep at our scale; the in-house `<Table>` covers sortable columns + filter chips + click-row in <200 LOC.
- **xterm.js** for peek — overkill (no need for terminal emulation, just a snapshot view). `ansi_up` (~3 KB) is sufficient.
- **Light theme / system-pref auto** — the operator can request in v1 if dark-default bites.

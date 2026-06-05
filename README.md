# gas-city-dashboard

An editorial-typographic ambient dashboard for a single [Gas City](https://github.com/gastownhall/gascity) (`gc`) operator. Home summarizes abnormal city state through the same attention model used by the nav and focused routes; Agents, Beads, Runs, Mail, Activity, and Health remain complete domain workspaces laid out as thoughtfully-set pages rather than a wall of cards. The room is calm by default; the only thing that earns the eye is something going wrong.

The shape is forked from [Wldc4rd/citadel](https://github.com/Wldc4rd/citadel) (MIT, Charlie Coutts) which solved the orchestrator-tab problem first. The visual register is a full redesign, driven through [impeccable](https://impeccable.style/) with the design context captured in [`specs/requirements/product.md`](specs/requirements/product.md) and [`DESIGN.md`](DESIGN.md).

## Repository status

This repository is a temporary workspace for developing the next Gas City dashboard. The intended destination is to replace the existing `gc dashboard` implementation in [`gastownhall/gascity`](https://github.com/gastownhall/gascity) once the dashboard is ready to fold back into the main `gc` codebase.

Until then, this repo exists so the dashboard can move quickly as a standalone Node/React application while preserving history, review, and CI separate from the main Gas City repo.

## What it shows

- **Home** — city-wide attention, grouped by domain, derived from the same live facts that highlight focused routes.
- **Agents** — every session's state at a glance, pending-interaction response controls, supervisor transcript peeks, and composed agent directives.
- **Beads** — engineering work in `gc bd` (system noise filtered by default), with supervisor-backed claim / close / nudge, targeted create-and-sling, and click-to-filter label chips.
- **Runs** — active formula runs, with graph.v2 run details, node session transcripts, and current execution-folder git diffs.
- **Mail** — read any agent's inbox via a persistent "Reading as" strip, with generated-supervisor send/reply/archive/read-state writes. Sends always go from the operator; impersonation is read-only.
- **Activity** — supervisor events, deploy history, and recent project commits in one operator-facing timeline with route-level filters.
- **Health** — supervisor state, host memory + load, admin process stats, local tool diagnostics, plus a 24-hour dolt-noms trend sparkline.
- **Maintainer / Triage** — optional first-party GitHub triage workspace, enabled with `MODULES_ENABLED=maintainer`; supervisor sling dispatch stays in the browser and the dashboard service records only local slung-state/audit facts.

## Quick start (dev)

```bash
git clone <your-clone-url> gas-city-dashboard
cd gas-city-dashboard
npm install
npm run build:shared            # types must build first

# Terminal 1 — backend on :8081
npm run dev:backend

# Terminal 2 — Vite dev server on :5174, proxies /api and /gc-supervisor → :8081
npm run dev:frontend
```

Then open `http://127.0.0.1:5174`. The dashboard expects a Gas City `gc supervisor` reachable on `http://127.0.0.1:8372` by default.

**Supported device surface.** Per [`specs/requirements/product.md`](specs/requirements/product.md), this dashboard targets a MacBook (typically via SSH port forward) and the host console. The layout stays stable from roughly 720px wide upward. Phone-size viewports are explicitly out of scope: there is no hamburger nav, no mobile drawer, no touch affordances. If the operator finds herself reaching for the phone, the answer is to open the laptop.

## Production build

```bash
npm install
npm run build
node backend/dist/server.js     # serves API + frontend on :8081
```

For systemd-managed install: [`deploy/README.md`](deploy/README.md).

## Quality gates

```bash
npm run lint       # ESLint, zero warnings allowed
npm run typecheck  # source + test TypeScript checks
npm --workspace shared test
npm --workspace frontend test
npm --workspace backend test
npm --workspace frontend run build
npm run openapi:gc-supervisor:check
```

When backend and frontend dev servers are running against a reachable
supervisor, run the browser smoke harness too:

```bash
npm run browser:test
```

### Live user-flow regression gate

`npm run dashboard:test` drives **real** operator flows (Home, Agents, Runs +
run-detail deep-link, Beads, Mail) against a running dashboard node and exits
non-zero on regression. Unlike `browser:test` (which uses mocked routes on the
`:5174` dev server), this gate hits live supervisor data and asserts:

- each route renders its header and content (never a blank false all-clear);
- no broken `/api/*` or `/gc-supervisor/*` responses and no console errors;
- the SSE stream reaches `live` on Agents/Runs;
- **fail-safe** — with every data call forced to 503, each route renders an
  explicit unavailable/degraded signal rather than a healthy-looking shell.

```bash
npm run dashboard:test                                   # default target http://127.0.0.1:8082
DASHBOARD_BASE=http://127.0.0.1:5174 npm run dashboard:test  # override the target
```

Like the snap harness it does **not** start its own server — it drives whatever
is serving the base URL, and **skips** (exit 0) when nothing is reachable, so a
non-zero exit always means a real regression.

## Configuration

All knobs are environment variables. See [`backend/src/config.ts`](backend/src/config.ts) for the authoritative list.

| Variable                    | Default                  | Purpose                                                                                                                                  |
| --------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                      | `8081`                   | TCP port the dashboard listens on                                                                                                        |
| `HOST`                      | `127.0.0.1`              | Bind interface. Set `0.0.0.0` for LAN access on a trusted network.                                                                       |
| `ADMIN_EXTRA_ALLOWED_HOSTS` | (empty)                  | CSV of extra hostnames allowed in the `Host:` header (e.g. `my-vm,192.168.1.58`). The floor `127.0.0.1` / `localhost` is always allowed. |
| `GC_SUPERVISOR_URL`         | `http://127.0.0.1:8372`  | gc supervisor API base URL.                                                                                                              |
| `GC_CITY_NAME`              | `racoon-city`            | Name of the city this dashboard manages. One dashboard per city.                                                                         |
| `MODULES_ENABLED`           | (empty)                  | CSV of optional first-party modules to mount, e.g. `maintainer`. Core views always mount.                                                |
| `DEFAULT_VIEW`              | (empty)                  | Optional module/view id to use as the city default route.                                                                                |
| `ADMIN_AUDIT_LOG_PATH`      | `$HOME/.gc/events.jsonl` | Where state-changing actions append audit entries.                                                                                       |
| `ADMIN_FRONTEND_DIST`       | `../frontend/dist`       | Path to built frontend assets.                                                                                                           |
| `ADMIN_DASHBOARD_DISABLED`  | `0`                      | Kill switch. Set to `1` to refuse to start.                                                                                              |

For local dev a `.env.local` is convenient (not auto-loaded; source it explicitly):

```bash
set -a; . ./.env.local; set +a
npm run dev:backend
```

## Security model

Built for **single-operator** use on a **trusted network**.

- **Default bind** is `127.0.0.1` only — DNS-rebinding floor.
- **Host-header allow-list** always permits `127.0.0.1` and `localhost`; LAN names opt in via `ADMIN_EXTRA_ALLOWED_HOSTS`.
- **CSRF** — state-changing endpoints require a token issued via cookie (double-submit pattern). The CSRF cookie is `gascity_admin_csrf`.
- **Origin check** — POST/PATCH/DELETE require an `Origin` matching the allowed-host set.
- **Content Security Policy** — `script-src 'self'` plus a hash for the static theme bootstrap, no arbitrary inline scripts, no `eval`.
- **Exec whitelist** — every shell-out is enumerated explicitly in [`backend/src/exec.ts`](backend/src/exec.ts). There is no general-purpose command execution path.

Full threat model: [`specs/architecture/security.md`](specs/architecture/security.md).

## Stack

- **Backend** — Node 20 + Express + TypeScript. Single port serves API at `/api/*` and the SPA from `/`.
- **Frontend** — React 18 + Vite + TypeScript + Tailwind, self-hosted Inter Variable. Single-page app, statically served by the backend in production.
- **Supervisor client** — generated OpenAPI client artifacts in backend and frontend. GC-owned resources should use these generated supervisor types directly.
- **Shared types** — `gas-city-dashboard-shared` workspace package for dashboard-owned `/api/*` DTOs and UI contracts, not supervisor DTO mirrors.
- **Deploy** — systemd user unit. Deliberately _not_ managed by `gc [[services]]`; see [`specs/architecture/overview.md`](specs/architecture/overview.md) for why the dashboard must outlive supervisor outages.

The durable direct-supervisor boundary is captured in
[`specs/architecture/direct-supervisor-boundary.md`](specs/architecture/direct-supervisor-boundary.md);
attention/domain surface rules are captured in
[`specs/architecture/attention-and-domain-surfaces.md`](specs/architecture/attention-and-domain-surfaces.md).

## Layout

```
gas-city-dashboard/
├── package.json              # npm workspace root
├── DESIGN.md                 # binding visual contract (agent-facing design standard)
├── shared/                   # dashboard-owned API and UI contract types
├── backend/                  # Express + TS
│   └── src/{server.ts,middleware,routes,gc-client.ts,exec.ts,audit.ts}
├── frontend/                 # React + Vite + Tailwind
│   └── src/{components,routes,contexts,styles}
├── specs/                    # requirements, architecture, plans
├── scripts/                  # Playwright snap harness for design iteration
└── deploy/                   # systemd unit + install README
```

## Design context

This codebase carries two committed design artifacts at the root:

- [`specs/requirements/product.md`](specs/requirements/product.md) — Who the operator is, what she's doing when she looks at this, the brand personality (_"considered, literary, instrumental"_), and the strategic anti-references (Datadog density, Linear dark-slate, hero-metric cards).
- [`DESIGN.md`](DESIGN.md) — Creative North Star _"The Reading Room"_, the warm-paper + warm-graphite + maroon palette, the single-typeface Inter system, the `Flat Page Rule`, `One Mark Rule`, `One Voice Rule`, `Greyscale Test`, and the explicit Do's and Don'ts.

Subsequent design changes should be measured against these documents. Re-run `/impeccable document` after substantial visual changes to regenerate `DESIGN.md` from the actual implementation.

## Credits

- Original codebase shape and orchestrator integration: [Charlie Coutts / Wldc4rd/citadel](https://github.com/Wldc4rd/citadel), MIT.
- Visual register and design system: this fork, applied via [impeccable](https://impeccable.style/) (Apache 2.0).
- Inter Variable: [Rasmus Andersson](https://rsms.me/inter/), SIL OFL.

## License

[MIT](LICENSE).

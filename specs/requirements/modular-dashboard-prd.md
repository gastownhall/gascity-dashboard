# PRD: Modular gas-city-dashboard architecture

> **Status:** Post-`/diverge → /converge → /premortem` synthesis. Ready to commit as `specs/requirements/modular-dashboard-prd.md`.
> **Beads in scope:** gascity-dashboard-9yj (P2 modularity), gascity-dashboard-ucc (P2 multi-city, design seams only), gascity-dashboard-dw8 (P3 default view).
> **Companion file:** `premortem_modular-dashboard.md` — full risk registry + failure narratives.

> **2026-06-01 architecture note:** this PRD predates the direct-supervisor
> replacement direction. Its module registry and `CityContext` ideas still
> apply to dashboard-local modules, but `CityContext.gc` and backend-mounted
> GC data modules are transitional. GC-owned resources should move to the
> generated browser supervisor client described in
> [`../plans/direct-supervisor-client-migration.md`](../plans/direct-supervisor-client-migration.md).

## Pipeline resolutions applied

This PRD has been through 3 refinement passes. Resolutions:

**Convergence (/converge — 6 design tensions):**
- Phase 2 trigger is outcome-based (a documented contract limitation), not module-count.
- `MODULES_ENABLED=csv` for enable/disable; `MAINTAINER_*` stays for module-internal config.
- Frontend registry + `/api/config.enabledModules` hierarchically (fail-soft on mismatch).
- `defaultRoute: true` descriptor flag + `DEFAULT_VIEW` env override (env wins).
- Audience hypothesis: scheduled bead + CI gate, not human-memory revisit.
- `CityContext.gc` was raw `GcClient` in Phase 1 with JSDoc seam flag. Under
  the direct-supervisor direction, this is migration debt for GC-owned
  resources, not a target module dependency.

**Premortem (/premortem — 6 failure lenses → 6 PRD changes):**
- **`needs` is REQUIRED (not optional)** + iterator uses existential `bind<D>()` wrapper, **no `as never`** anywhere. Boot-time validation enforces.
- **Pre-PR-B Maintainer coupling audit** (new doc `specs/architecture/maintainer-coupling-audit.md`) required before PR-B opens; PR-B splits into PR-B1 (relocate + adapt) + PR-B2 (registry wire).
- **`specs/architecture/module-author-checklist.md`** + ESLint overrides on `**/views/modules/**` + new CI grep gates promote module conventions from culture-carried to machine-enforced.
- **Audience-hypothesis revisit becomes a scheduled `bd ready` bead** + CI breaks if target date passes without a tombstone doc.
- **`ViewDescriptor` + `BackendModule` types exported from `shared/` in Phase 1** (not Phase 2). The internal-vs-public cleavage was foreclosing extension before any benefit was paid.
- **`resources` discriminator field** (`'perProcess' | 'perCity'`) on `BackendModule` + two-CityContext acceptance test in Phase 1.

## Problem statement

The dashboard ships three contradictions:

1. **The Maintainer/Triage surface is a default route** (`App.tsx:40`, `Header.tsx:19`, `app.ts:113-127`). It is specific to one operator's GitHub workflow on `gastownhall/gascity`. Every other Gas City operator pays the cognitive cost of a nav entry they cannot use; the backend pays the runtime cost of `MaintainerRefresher` (`app.ts:139-150`) regardless.
2. **There is no extension path that isn't a fork.** `specs/architecture/extending.md` documents adding a view by editing `App.tsx` + `Header.tsx` + `server.ts`. The codebase describes views three times in three files; there is no single descriptor an operator (or first-party author) can register.
3. **Multi-city (`ucc`) will land into a single-city-shaped registry.** `app.ts:72-127` instantiates one `GcClient`, one `SnapshotService`, one `MaintainerRefresher` per process. Threading a city dimension through ten routers + three workers + the frontend `/api/config` consumer at the same time as the multi-city UX work is too much surface for one PR.

**Counter-evidence (kept loud per challenger lens):** specs/requirements/product.md, DESIGN.md, package.json, README.md all describe the dashboard as a "single-operator" tool. Repo stats: 0 stars, 1 self-fork, 0 issues. The "OOTB for any operator" framing exists in bead 9yj and the conversation that triggered this PRD — never externally validated. This PRD builds the audience question into Phase-1 entry (scheduled `bd ready` bead before PR-A merges, CI gate on revisit date) and the Phase-2 trigger (outcome-based) so the public-contract investment only proceeds on real signal.

## Goals & non-goals

### Goals

- **G1 (Phase 1):** Replace the three parallel view registries with a single `ViewDescriptor` + `BackendModule` contract **exported from `shared/`**. The compile-time edit IS the design-review checkpoint.
- **G2 (Phase 1):** Make Maintainer opt-in via `MODULES_ENABLED` env. Default install has no `/maintainer` nav, no `/maintainer` route, no Maintainer worker, no Maintainer cache I/O.
- **G3 (Phase 1):** Introduce `CityContext` as the city-scoping seam at module mount time so `ucc` (Phase 2) does not require re-signing every router factory. Acceptance includes a two-CityContext smoke test against real (non-mocked) `GcClient` for the legacy backend GC facade. Under the direct-supervisor migration, new GC-owned module data should use the generated browser supervisor client instead.
- **G4 (Phase 1):** Preserve every existing primary value loop. No regressions to the snap harness, the One Mark Rule, any DESIGN.md invariant.
- **G5 (Phase 2, gated on outcome):** Implement multi-city. **Trigger: a documented Phase-1 contract limitation in a bead.**
- **G6 (Phase 3, sketched only):** Open the contract to third-party modules. **Trigger softened (premortem #6):** a single external operator filing a non-fork extension request OPENS a Phase 2/3 design bead. Two-signal gates where signal #1 is told to wait don't generate signal #2.

### Non-goals (all phases)

- Runtime module loader, frontend CDN, third-party signing, marketplace, sandbox isolation, descriptor-level permission grants, per-tab-per-city UX, cross-module event bus, `/modules` admin view.
- Migrating Mail, Beads, Activity, or any other core view to a module in this PRD. Only Maintainer.
- Replacing `shared/` as the dashboard-local service/UI contract package,
  Layout/Header/NowProvider/ViewingAsProvider editorial frame, or
  `app.listen(...,'127.0.0.1',...)` network surface. `shared/` is no longer the
  target SSOT for supervisor wire shapes; generated supervisor OpenAPI types are.

## 1. Plugin API surface (Phase 1)

**Descriptor types live in `shared/` from Phase 1.** (Premortem #6: the internal-vs-public cleavage was foreclosing extension with no benefit at this scale; the `shared/` package is small enough that adding two interfaces costs nothing.)

### `ViewDescriptor` — `shared/src/views.ts`

```ts
import type { ComponentType, LazyExoticComponent } from 'react'

export interface ViewDescriptor {
  /** Stable id; matches MODULES_ENABLED entries; lowercase, hyphen-allowed. */
  id: string
  /** core = always mounted, cannot appear in MODULES_ENABLED filter.
   *  firstParty = optional, in-tree, ships with core. */
  kind: 'core' | 'firstParty'
  /** React Router path. Unique. '/' allowed iff defaultRoute resolves here. */
  path: string
  /** Nav entry. null = routable but hidden from Header. */
  nav: { label: string; order: number } | null
  /** Lazy-loaded route element. React.lazy keeps each module's chunk out
   *  of the default-install bundle. */
  element: LazyExoticComponent<ComponentType>
  /** Module's declared candidacy for `/`. Operator may override via
   *  DEFAULT_VIEW env. Registry validates exactly-one resolution. When
   *  the composer-shape lands (future bead, deferred from dw8),
   *  `defaultRoute: true` becomes sugar for
   *  `homeContribution: { weight: Infinity, concernsFn: () => [...] }`
   *  — the shapes are compatible by construction. */
  defaultRoute?: boolean
}
```

### `BackendModule` + `CityContext` — `shared/src/views.ts`

```ts
import type { Router } from 'express'
import type { GcClient } from '<backend type-export>' // type-only re-export per shared/ rules
import type { AdminConfig } from '<backend type-export>'
import type { DashboardRuntimeConfig } from './index.js'

/** Background worker contract — bound by the host runtime. Cleaned up to
 *  match the actual MaintainerRefresher shape rather than the old
 *  DashboardRuntime mismatch (premortem #2). */
export interface BackgroundWorker {
  start(): void
  stop(): Promise<void>
}

/** The city-scoping seam. Phase 1: one. Phase 2 (ucc): Map<cityName,
 *  CityContext>, with the same per-module mount signature. */
export interface CityContext {
  cityName: string
  cityPath: string
  /** Per-city data directory. Modules MUST derive paths from this, not
   *  from config-dirname operations. Closes the leak surface premortem
   *  #5 found (per-city MaintainerRefresher writing the same global path). */
  cityDataDir: string
  /**
   * Transitional raw GcClient for backend modules that have not yet moved to
   * the direct browser supervisor client. Do not add new GC-owned module data
   * dependencies here; add supervisor OpenAPI and frontend generated-client
   * calls instead.
   */
  gc: GcClient
  config: DashboardRuntimeConfig
}

/** Resource lifetime posture declared at descriptor time so Phase 2
 *  multi-city can verify lifetime invariants statically (premortem #5).
 *  Modules MUST declare every resource they own. */
export interface ModuleResources {
  /** Filesystem paths the module writes to. 'perCity' = one path per
   *  CityContext (derived from ctx.cityDataDir); 'perProcess' = one
   *  path shared across all cities (rare; e.g. a global audit log). */
  filesystem?: ReadonlyArray<{ name: string; scope: 'perProcess' | 'perCity' }>
  /** Network sockets / connection pools the module holds. */
  network?: ReadonlyArray<{ name: string; scope: 'perProcess' | 'perCity' }>
  /** In-memory caches / SSE client registries. */
  memory?: ReadonlyArray<{ name: string; scope: 'perProcess' | 'perCity' }>
}

export interface BackendModule<Deps = void> {
  /** Matches ViewDescriptor.id. */
  id: string
  /** Resource lifetime posture. Required (premortem #5). */
  resources: ModuleResources
  /** Owns its config slice. REQUIRED (not optional) per premortem #3 —
   *  the optional `?` + `as never` cast erased the Deps contract. Modules
   *  with Deps = void return undefined explicitly: `needs: () => undefined`. */
  needs: (config: AdminConfig) => Deps
  /** Mounts under /api/<id>. Auto-wrapped by csrfValidate at writeRouter
   *  level. Read-only modules just don't register POST/PUT/DELETE handlers. */
  mount: (ctx: CityContext, deps: Deps) => Router
  /** Optional background worker. start()/stop() called by host runtime. */
  workers?: (ctx: CityContext, deps: Deps) => BackgroundWorker | undefined
}
```

### Worked example — Maintainer-as-internal-module

```ts
// backend/src/views/modules/maintainer.module.ts
import path from 'node:path'
import { maintainerRouter } from '../../routes/maintainer.js'
import { createMaintainerRefresher } from '../../maintainer/worker.js'
import { raceWithTimeout } from '../../lib/race-with-timeout.js'
import type { BackendModule } from 'gas-city-dashboard-shared'

interface MaintainerDeps {
  repo: string
  cachePath: string
  slungStatePath: string
  slingTarget: string
  triageTarget: string
  refreshIntervalMs: number
}

export const maintainerBackend: BackendModule<MaintainerDeps> = {
  id: 'maintainer',
  resources: {
    filesystem: [
      { name: 'cache', scope: 'perCity' },
      { name: 'slung-state', scope: 'perCity' },
    ],
    memory: [
      { name: 'sse-clients', scope: 'perCity' },
    ],
  },
  needs: (config) => ({
    repo: config.maintainerRepo,
    cachePath: config.maintainerCachePath,
    slungStatePath: path.join(path.dirname(config.maintainerCachePath), 'slung-state.json'),
    slingTarget: config.maintainerSlingTarget,
    triageTarget: config.maintainerTriageTarget,
    refreshIntervalMs: config.maintainerRefreshIntervalMs,
  }),
  mount: (ctx, deps) =>
    maintainerRouter({
      // NOTE: paths derive from ctx.cityDataDir to honor the perCity declaration above.
      repo: deps.repo,
      cachePath: path.join(ctx.cityDataDir, 'maintainer-cache.json'),
      slungStatePath: path.join(ctx.cityDataDir, 'slung-state.json'),
      slingTarget: deps.slingTarget,
      triageTarget: deps.triageTarget,
      sling: (input) => ctx.gc.sling(input),
      listSessions: async () => {
        const { items } = await raceWithTimeout(ctx.gc.listSessions(), 3_000)
        return items
      },
    }),
  workers: (ctx, deps) =>
    deps.refreshIntervalMs > 0
      ? createMaintainerRefresher({
          repo: deps.repo,
          cachePath: path.join(ctx.cityDataDir, 'maintainer-cache.json'),
          slungStatePath: path.join(ctx.cityDataDir, 'slung-state.json'),
          intervalMs: deps.refreshIntervalMs,
        })
      : undefined,
}
```

### Frontend module — `frontend/src/views/modules/maintainer.module.tsx`

```tsx
import { lazy } from 'react'
import type { ViewDescriptor } from 'gas-city-dashboard-shared'

export const maintainerView: ViewDescriptor = {
  id: 'maintainer',
  kind: 'firstParty',
  path: '/maintainer',
  nav: { label: 'Triage', order: 80 },
  element: lazy(() =>
    import('../../routes/Maintainer').then((m) => ({ default: m.MaintainerPage })),
  ),
}
```

### CI invariants

- `grep -rn 'config\.cityName\|config\.cityPath' backend/src/views/modules/` returns zero hits (modules must read from `ctx`).
- `grep -rn "^const.*= new Set\|^const.*: Array\|^const.*: Map" backend/src/views/modules/` returns zero hits (no module-level mutable singletons — premortem #2 SSE-registry bug class).
- `grep -rn 'as never' backend/src/app.ts` returns zero hits (premortem #3 type-erasure ban).
- ESLint config adds module-scoped overrides on `**/views/modules/**`: ban `dangerouslySetInnerHTML`, raw `setInterval`/`setTimeout` identifiers, bare `fetch(` data-fetch in React components (premortem #4 convention drift).
- A `// module-allow: <reason>` line-comment marker opts a specific line out of grep gates with documented rationale.

## 2. Backend module mounting (no `as never`)

Iterator uses an existential `bind<D>()` wrapper that closes over `D` per-module and returns a uniform `MountedModule` for app.ts to iterate:

```ts
import { ALL_MODULES } from './views/registry.js'

interface MountedModule {
  id: string
  mount: (ctx: CityContext) => Router
  worker?: (ctx: CityContext) => BackgroundWorker | undefined
}

function bind<D>(mod: BackendModule<D>, config: AdminConfig): MountedModule {
  const deps = mod.needs(config) // REQUIRED — not optional. Modules with Deps=void return undefined.
  return {
    id: mod.id,
    mount: (ctx) => mod.mount(ctx, deps),
    worker: mod.workers ? (ctx) => mod.workers!(ctx, deps) : undefined,
  }
}

const enabled = new Set(config.enabledModules)
const ctx: CityContext = {
  cityName: config.cityName,
  cityPath: config.cityPath,
  cityDataDir: path.join(config.dashboardDataDir, 'cities', config.cityName),
  gc,
  config: dashboardConfig,
}
const workers: BackgroundWorker[] = []

for (const mod of ALL_MODULES) {
  if (mod.kind !== 'core' && !enabled.has(mod.id)) continue
  const bound = bind(mod, config)
  writeRouter.use(`/${bound.id}`, bound.mount(ctx))
  const w = bound.worker?.(ctx)
  if (w) workers.push(w)
}
```

Iterator never sees `Deps`. Each module's deps are bound at `bind<D>` time and live in the closure. No `as never`. Boot-time validation throws if `mod.needs` is not a function.

### Two env conventions

- **`MODULES_ENABLED=csv`** — enable/disable lever. Single knob. Default unset = all modules mount. PR-D flip default omits `maintainer`.
- **`MAINTAINER_REPO` etc.** — module-internal config (existing pattern). Maintainer's `needs(config)` reads `config.maintainerRepo`.

`MODULES_ENABLED` cannot omit `kind: 'core'` ids — validation throws.

### Validation at boot

- Exactly one resolved `/` route (from `defaultRoute: true` descriptors + optional `DEFAULT_VIEW` env override).
- No duplicate `id`, `path`, or `nav.path`.
- Every enabled `BackendModule` has a working `needs` function.
- `MODULES_ENABLED` references only known `id`s.
- For each enabled module, every `resources.{filesystem,network,memory}` entry has a name unique within the module.

### Loud signal (premortem #4 — DEFAULT_VIEW shadow)

Default-route resolution logs at **warn** level (not info) when `DEFAULT_VIEW` env overrides a descriptor's `defaultRoute: true`. The shadowed module id is named in the message. Echoed into `/api/config` as `defaultViewResolution: { source: 'env' | 'descriptor', winner: string, shadowed: readonly string[] }` so the frontend renders a dev-mode banner when `shadowed` is non-empty.

## 3. Frontend module mounting

Two-layer SSOT: frontend registry = "what views exist in bundle"; `/api/config.enabledModules` = "what views to mount at runtime." Mismatch fails soft (frontend renders "Module unavailable in this deployment" copy).

```tsx
export function App() {
  const { data: config } = useCachedData('config', () => api.config())
  const enabledIds = new Set(config?.enabledModules ?? [])
  const views = ALL_VIEWS.filter((v) => v.kind === 'core' || enabledIds.has(v.id))
  const defaultId = config?.defaultViewResolution?.winner
  const defaultView = views.find((v) => v.id === defaultId)
    ?? views.find((v) => v.defaultRoute)

  return (
    <ViewingAsProvider>
      <NowProvider>
        <Layout>
          <Suspense fallback={<RouteSkeleton />}>
            <Routes>
              {defaultView && <Route path="/" element={<defaultView.element />} />}
              {views.map((v) => (
                <Route key={v.id} path={v.path} element={<v.element />} />
              ))}
              <Route path="*" element={<ModuleUnavailableRoute />} />
            </Routes>
          </Suspense>
        </Layout>
      </NowProvider>
    </ViewingAsProvider>
  )
}
```

`Header.tsx`:

```ts
const ROUTES = ALL_VIEWS
  .filter((v) => (v.kind === 'core' || enabledIds.has(v.id)) && v.nav)
  .sort((a, b) => a.nav!.order - b.nav!.order)
  .map((v) => ({ to: v.path, label: v.nav!.label, end: v.path === '/' }))
```

### Bundle-size gate

Default-install bundle (Maintainer omitted) is smaller than pre-migration by at least the Maintainer chunk size. CI checks via `vite build --report` size diff in PR-D.

## 4. First-party vs third-party

**Phase 1: all `kind: 'firstParty'` or `kind: 'core'`.** Cleavage justified on capability:

| Capability | core + firstParty | thirdParty (Phase 3 sketch) |
|---|---|---|
| Raw `GcClient` | ✓ | scoped wrapper |
| Raw `cityPath` filesystem | ✓ | denied |
| `exec.ts` privileged helpers | ✓ | denied |
| `cityDataDir` writes | ✓ | ✓ |
| Audit log emit | ✓ | ✓ |
| SSE channel registration | ✓ (namespaced) | ✓ (namespaced) |

### Stays core

`/` (ambient home), `/agents` + `/agents/:slug`, `/runs` + `/runs/:id`, `/health`, plus dashboard-local host/city utilities such as `/api/health/*`, `/api/builds`, and `/api/city/:cityName/runs/:runId/diff`. Snapshot, event, session list, transcript, and session stream data are supervisor-owned and should be consumed through `/gc-supervisor/v0/...`, not mirrored through dashboard DTOs.

### Becomes a module (Phase 1 ports one)

`/maintainer` ("Triage"). The slung-state primitive stays in core; the GitHub-issue/PR triage UI moves into the maintainer module.

### Stays in core for now

`/beads`, `/mail`, `/activity` — future migration as their own beads.

## 5. Multi-city design seams (ucc — DESIGN ONLY)

`CityContext` is the seam. Single-city today = one. Multi-city (Phase 2) = `Map<cityName, CityContext>` and the per-module `mount(ctx, deps)` signature does not change.

Each module declares `resources` posture so Phase 2 verifies lifetime statically.

### Phase 2 sketch

- `AdminConfig.cities: readonly { name, path, supervisorUrl }[]` + `currentCityName`.
- URL-segment scoping (`/:city/agents`); single-city stays unsegmented via 302 redirect.
- `BackendModule.workers` becomes `Map<cityName, BackgroundWorker>`. Per-module function signature unchanged.
- Header has a hard-navigation city switcher.

### Phase 1 acceptance for the seam

- `BackendModule.mount` reads from `ctx.cityName`/`ctx.cityPath`/`ctx.cityDataDir` (grep gate).
- **Two-CityContext smoke test** in `backend/test/views-multi-city-seam.test.ts`: constructs two CityContexts against a real (non-mocked) `GcClient`, mounts a fixture module that declares `resources.network: [{ name: 'gc', scope: 'perCity' }]`, asserts (a) no path collisions across `workers()`, (b) network socket count grows linearly with cities and releases on `stop()`, (c) `cityDataDir` paths are unique per city. Catches premortem #5's class of bug before module proliferation.

## 6. Default view post-modularity (dw8)

`/` resolution: descriptor flag + env override.

1. Descriptors may set `defaultRoute: true` — module author candidacy.
2. Operator may set `DEFAULT_VIEW=<module-id>` — overrides descriptor flags.
3. Validation: exactly one resolved default. Warn-level boot log + `/api/config.defaultViewResolution` echo when env overrides descriptor.

### dw8 mapping

- OOTB: `homeView.defaultRoute = true`, `DEFAULT_VIEW` unset → `/` = AmbientHome.
- Stephanie's deployment: `DEFAULT_VIEW=needs-you` → `/` = Needs-You.

### Composer compatibility

`defaultRoute: true` is documented as **sugar for** a future `homeContribution: { weight: Infinity, concernsFn: () => [{ route: descriptor.path }] }` shape. If the composer pattern lands later (its own bead, deferred from dw8), migration is additive — modules add `homeContribution`, and the shell prefers composition over single-default-route when ≥2 contributors exist. `defaultRoute` remains as a sugar shorthand. Premortem #6 forces this design decision in Phase 1 to avoid foreclosing the composer path.

## 7. Migration strategy

### Pre-PR-A: Maintainer coupling audit (`specs/architecture/maintainer-coupling-audit.md`)

**Required before PR-A merges.** Written inventory of every cross-boundary touch Maintainer makes today:
- SSE client registry held as module-singleton state in `maintainer/sse.ts`.
- `slungStatePath` duplicated in `app.ts:109` and `routes/maintainer.ts:480`.
- Maintainer's session-list injection uses the shared `raceWithTimeout` helper from `backend/src/lib/race-with-timeout.ts`.
- `maintainer/worker.ts:6` imports `notifyRefresh`/`sendHeartbeat` from `./sse.js`.
- `gc-client.ts:273` comment-references slung-state.
- The `MaintainerRefresher` shape vs the new `BackgroundWorker` shape — adapter required in PR-A.

Each entry gets a disposition: kept inside module / promoted to `CityContext` / adapted in PR-A / requires PRD revision. Premortem #2 mitigation — the doc surfaces what PR-B would otherwise hit blind.

### Audience-hypothesis scheduled bead

**Required before PR-A merges.** Replace the original "write a `bd remember` entry" gate with: `bd create --type=task --priority=p2 --ready-after=<+6mo> --title="Revisit modular-dashboard audience hypothesis"`. The bead appears in `bd ready` on the target date. Description carries the conditional remediation language from the convergence resolution. **CI gate:** a check that fails if today > target_date AND `specs/requirements/PLUGIN-API-DEFERRED.md` does not exist AND the bead is still open. Premortem #1 mitigation.

### PR sequence

| PR | Diff shape | Risk |
|---|---|---|
| **PR-A** — Audit doc + scheduled bead + types in `shared/` + registry skeleton + `/health` port. | Adds `shared/src/views.ts`, `views/registry.ts`, `views/modules/health.module.ts`, audit doc, scheduled bead. Modifies App.tsx/Header.tsx/app.ts to read `healthView` from registry. **Adapts `MaintainerRefresher` to `BackgroundWorker` shape** so PR-B has a typed target. | LOW. |
| **PR-B1** — Relocate Maintainer files + adapt to contract (NO registry wire yet). | Moves files; updates imports to satisfy contract; snap harness + Maintainer integration tests pass against the new file layout while app.ts still explicitly mounts maintainer. **Snap harness extended with SSE-roundtrip for `/maintainer/events`** to catch singleton-split. | MEDIUM. The risky half. |
| **PR-B2** — Wire Maintainer through registry; delete explicit app.ts mounts. | Mechanical iterator wiring. | LOW once B1 lands. |
| **PR-C** — `MODULES_ENABLED` env + `/api/config.enabledModules` + `DEFAULT_VIEW` env + ESLint module overrides + `specs/architecture/module-author-checklist.md`. | Additive. Default = all modules mount. | LOW. |
| **PR-D** — Flip default to exclude maintainer. CHANGELOG migration note. Bundle-size gate verifies. | 1-line config + docs. | LOW. The user-visible default-install change. |

### CI gates added

- `grep -rn 'config\.cityName\|config\.cityPath' backend/src/views/modules/` returns zero hits.
- `grep -rn "^const.*= new Set\|^const.*: Array\|^const.*: Map" backend/src/views/modules/` returns zero hits (no module-level singletons).
- `grep -rn 'as never' backend/src/app.ts` returns zero hits.
- ESLint overrides on `**/views/modules/**` (banned: `dangerouslySetInnerHTML`, raw `setInterval`/`setTimeout`, bare `fetch(` data-fetch).
- Module-author checklist file referenced from PR template; reviewers required to confirm checklist when files under `*/views/modules/**` change.
- Audience-hypothesis CI check (described above).

### Acceptance criteria (verifiable)

- After PR-B2: `App.tsx`, `Header.tsx`, `app.ts` contain zero hand-maintained per-module lists. `grep -n "app\\.use\\(['\"]\\/maintainer" backend/src/app.ts` returns zero hits.
- After PR-D: direct supervisor agent reads continue to work; `curl /api/maintainer/...` returns 404; Header has no "Triage" entry; JS bundle smaller by the Maintainer chunk size; `MODULES_ENABLED=maintainer,...` restores pre-migration behavior byte-for-byte.
- Two-CityContext smoke test (§5) passes.
- Audience-hypothesis bead exists with target date ≤6mo from PR-A merge.

## 8. What's NOT in scope (explicit non-goals)

- Phase 1: multi-city implementation beyond `CityContext` plumbing + the seam-verifying smoke test.
- Phase 1: third-party module distribution, signing, sandboxing.
- All phases: per-module CSRF opt-out, runtime hot-load, cross-module event bus, module-level access control, per-tab-per-city UX, frontend-bundle CDN, module marketplace.
- All phases: AmbientHome composer implementation (separate future bead — Phase 1 makes `defaultRoute` compatible with it but doesn't ship it).
- All phases: changing `app.listen(config.port, '127.0.0.1', ...)`.
- All phases: replacing Layout, Header, NowProvider, ViewingAsProvider.

## Risk registry (from /premortem — full narratives in `premortem_modular-dashboard.md`)

| # | Lens | Severity | Likelihood | Score | Mitigation in this PRD |
|---|---|---|---|---|---|
| 1 | PR-B Maintainer decoupling explodes | High | High | 9 | §7: pre-PR-A coupling audit; PR-B split; SSE-roundtrip in snap harness |
| 2 | Module convention drift | High | High | 9 | §1: ESLint overrides + grep gates; §2: DEFAULT_VIEW warn+echo; §7: MODULE-AUTHOR-CHECKLIST |
| 3 | Type-erasure `as never` crash | High | High | 9 | §1: `needs` required; §2: existential `bind<D>()` wrapper; §7: grep gate banning `as never` |
| 4 | Audience hypothesis expires | Medium | High | 6 | §7: scheduled `bd ready` bead + CI break on date pass |
| 5 | CityContext multi-city memory leak | High | Medium | 6 | §1: `resources` discriminator + `cityDataDir`; §5: two-CityContext smoke test |
| 6 | Extensibility foreclosure | High | Medium | 6 | §1: descriptor types in `shared/` from Phase 1; §6: composer sugar compatibility; G6: softened Phase 3 trigger |

## Open questions

- ~~Q1-Q2~~ resolved by /converge (T1, T2).
- ~~Q5~~ resolved by /premortem (now hard-enforced via grep gate).
- **Q3:** `nav.order` operator-overridable in Phase 2? Defer until asked.
- **Q4:** How does `useViewingAs` / `useNow` reach modules — re-exported via a `ModuleFrontendContext`, or direct imports from `frontend/src/contexts/`? **Phase 1: direct imports** (smaller API surface); Phase 2 introduces context wrapper if module isolation becomes a concern.
- **Q6:** Module test colocation — `backend/src/views/modules/<id>/__tests__/` or root-level `backend/test/`? **Recommend colocated** under each module's dir.
- **Q7:** Latency budget for `/api/config.enabledModules` (runs on every dashboard load)? **Recommend** in-process cache; modules don't change at runtime.

## Research provenance

- **/diverge (5 agents):** micro-frontend, filesystem-discovery, compile-time-registration, honest-monolith challenger, growth-path. Convergence adopted growth-path phasing + compile-time-registration mechanism + challenger's audience discipline.
- **/converge (6 tensions):** all 6 resolved with dissent preserved (challenger's "stop here, write the tombstone" is the default Phase-1-permanent landing place if Phase 2 trigger never fires).
- **/premortem (6 failure lenses):** all 6 mitigations applied directly to the PRD body. The 3 high-likelihood risks (PR-B coupling, convention drift, `as never` crash) drove the largest structural changes (audit doc, ESLint overrides + grep gates, existential `bind` wrapper).

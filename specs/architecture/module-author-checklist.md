# Module author checklist

Practical guide for anyone adding a view module to gas-city-dashboard, first-
party (in this repo) or third-party (Phase 3 — capability-scoped sketch, not
yet wired). The PRD (`specs/requirements/modular-dashboard-prd.md`) covers the rationale;
this file is the actionable summary. If you are extending an existing module
instead of adding a new one, only the invariants in §2 apply — skip §3.

A module is a single backend `BackendModule<Deps>` paired with a single
frontend `ViewDescriptor`. Both live in their own directories under
`backend/src/views/modules/<id>/` and `frontend/src/views/modules/<id>/`.
The `id` is the URL slug, the log namespace, the MODULES_ENABLED toggle, and
the directory name — keep them identical.

Architecture note: backend modules are for dashboard-local capabilities. If a
view needs GC-owned data or mutations, use the generated browser supervisor
client or add the missing capability to the GC supervisor API. Do not add a new
backend module merely to mirror supervisor DTOs through `/api/*`.

## 1. The contract

Every field's semantic invariant lives on the JSDoc at the type definition.
Read those — this section is the map.

### `BackendModule<Deps>` — `shared/src/views.ts:123`

| Field | Role |
|---|---|
| `id` | URL slug AND log namespace AND MODULES_ENABLED entry. Must match the frontend `ViewDescriptor.id`. Lowercase, hyphens allowed. |
| `kind` | `'core'` mounts unconditionally (operators cannot disable it). `'firstParty'` is opt-in via MODULES_ENABLED. |
| `resources` | Declares which filesystem/network/memory resources the module owns and at what lifetime (perProcess / perCity). Phase 2 (multi-city) verifies these statically — see `ModuleResources` at `shared/src/views.ts:88` and `ModuleResourceEntry` at `shared/src/views.ts:82`. |
| `needs(config)` | Projects the host's `AdminConfig` into your module-private `Deps`. REQUIRED — modules with `Deps = void` return `undefined` explicitly. Never `Deps?:` + `as never`. |
| `mount(ctx, deps)` | Returns an Express `Router`. Bound under `/api/<id>`. The `ctx` is the `CityContext` — see `shared/src/views.ts:98`. |
| `workers(ctx, deps)` | Optional `BackgroundWorker` (`shared/src/views.ts:75`). The host calls `start()` once and `stop()` on shutdown. Return `undefined` to opt out. |

`Deps` is generic on each module so the registry's `BackendModule<unknown>`
array can hold heterogeneous modules; the existential `bind<D>()` wrapper
in `backend/src/views/types.ts` re-closes the type at mount time — the
iterator in `app.ts` never sees `Deps`.

### `ViewDescriptor<TElement>` — `shared/src/views.ts:50`

| Field | Role |
|---|---|
| `id` | Same id as the backend module. |
| `kind` | Must agree with the backend's kind. |
| `path` | React Router route. Unique across `ALL_VIEWS`. |
| `nav` | `{ label, order }` or `null`. `null` = routable but hidden from the header. See `ViewNavEntry` at `shared/src/views.ts:42`. |
| `element` | Lazy-loaded component. The frontend re-types `TElement` as `LazyExoticComponent<ComponentType>` — keep your descriptor on `React.lazy(...)` so your chunk stays out of the first-paint bundle. |
| `defaultRoute?` | Module's candidacy for `/`. Operators override via `DEFAULT_VIEW`. Validation: at most one ENABLED view should set this — the frontend resolver picks the lowest `nav.order` and warns when more than one is flagged. |

Legacy route aliases are intentionally unsupported. Delete old routes instead of preserving redirects.

## 2. Invariants you MUST respect

These are codebase-wide rules; ignoring them is the most common review-
rejection cause.

- **127.0.0.1 by default.** The backend binds loopback only. `HOST=0.0.0.0`
  is operator-explicit; do not assume LAN exposure. Forward the Vite port
  over SSH for remote dev — never expose the backend.

- **CSRF + Origin allow-list on writes.** Anything that mutates state
  mounts under the `writeRouter` in `backend/src/app.ts`, which runs the
  CSRF validator + origin check before your handler sees the request. Do
  not bypass with `app.use(...)`. Read-only endpoints (GET) can mount
  outside `writeRouter`.

- **DESIGN.md is the binding visual contract.** Re-read it before any UI
  or UI-copy change in the frontend descriptor's component. The named
  rules and style absolutes outrank habit.

- **One canonical SSE singleton per module.** If your module exposes an
  SSE stream, define ONE `Set<Response>` in the module's own file and
  annotate that line with a `// module-allow:` marker so the
  no-module-singletons grep gate skips it. See
  `backend/src/views/modules/maintainer/sse.ts` for the established
  pattern.

- **Per-city files under `ctx.cityDataDir`.** The host constructs
  `ctx.cityDataDir = ~/.gascity-dashboard/cities/<cityName>/`. Your
  module creates the directory itself (`fs.mkdir(path.dirname(myFile),
  { recursive: true })`) before writing. The host's `cityName` is
  validated at config-load time so the path segment cannot escape
  `cities/` — do NOT do your own re-validation, do NOT compose
  `..` into the path.

- **No cross-module imports.** Modules talk to each other through
  `CityContext` and `ModuleResources`, never via direct imports between
  `views/modules/<X>/` and `views/modules/<Y>/`. The ESLint rule in
  `eslint.config.mjs` enforces this. Common imports (shared/, lib/,
  logging, config, anything OUTSIDE `views/modules/`) stay allowed.

- **Audit log via the host's writer.** Privileged actions append to the
  shared audit log; do not open `.gc/events.jsonl` directly from your
  module — use the existing audit writer surface.

## 3. Wiring a new module

Five edits, in order. Each one fails closed if you skip it.

1. **Create the module dirs:**
   `backend/src/views/modules/<id>/<id>.module.ts` (exports a
   `BackendModule<Deps>`) and
   `frontend/src/views/modules/<id>/<id>.module.tsx` (exports a
   `ViewDescriptor`). Lazy-import the React component so your chunk
   stays out of the first-paint bundle.

2. **Register on the backend:** add your module to `ALL_MODULES` in
   `backend/src/views/registry.ts`. The `register()` helper widens
   `Deps` to `unknown` — keep using it; do not `as unknown` by hand.

3. **Register on the frontend:** add your view to `ALL_VIEWS` in
   `frontend/src/views/registry.ts`.

4. **Add to the ESLint isolation list:** append your module's id to
   `MODULE_NAMES` inside `moduleIsolationConfigs()` in
   `eslint.config.mjs`. This makes the cross-module-import rule cover
   sibling references TO your module. (If you forget, your own module
   is still isolated, but other modules can still import from yours.)

5. **Add operator config (if needed):** if your module reads env-driven
   knobs, add the slice under `AdminConfig.modules.<id>` in
   `backend/src/config.ts` and project it via `needs(config)`. The
   wire-shape `DashboardRuntimeConfig` deliberately omits module slices
   — module config is host-side only.

`MODULES_ENABLED` is the OPERATOR'S opt-in switch, not the developer's.
Adding your module to `ALL_MODULES` does not auto-enable it for every
deployment; the operator opts in by editing the env. (`kind: 'core'`
bypasses the switch.)

## 4. Testing

- **Colocate `*.test.ts(x)` under your module dir.** Backend uses
  Node's built-in test runner with bash globstar
  (`shopt -s globstar nullglob; node --import tsx --test src/**/*.test.ts`);
  frontend uses Vitest. Both pick up colocated tests automatically.

- **Cover the registry surface.** Your module should appear in
  `backend/test/views-registry.test.ts` and
  `frontend/src/views/registry.test.ts`'s id list. Both files iterate
  the registry, so the addition is a one-line assertion.

- **Cover the enable filter.** If your module is `firstParty`, add a
  test that `MODULES_ENABLED='<your-id>'` mounts you and
  `MODULES_ENABLED=''` does not. The shared resolver lives at
  `backend/src/views/enabled.ts` (backend) and
  `frontend/src/views/resolve.ts` (frontend) — extend their existing
  fixture tests rather than re-creating registries.

- **Two-CityContext smoke test (Phase 1 acceptance, premortem #5).**
  When your module declares `resources.{filesystem,network,memory}`
  entries with `scope: 'perCity'`, the resource paths it derives from
  `ctx.cityDataDir` must be unique per city. Write the assertion in
  your module's own test file; the host's seam test
  (`backend/test/views-multi-city-seam.test.ts`) is the cross-cutting
  gate.

- **No cross-module-import test fixture.** The ESLint rule alone is
  insufficient on its own — verify it by temporarily inserting a
  forbidden import, running `npm run lint`, confirming the error,
  reverting. The rule shipped with PR-C (bead 9yj.5) was validated
  this way against `maintainer/router.ts` → `../health.module.js`.

If any of this is wrong against the source, the source wins — open a
bead and fix this file too.

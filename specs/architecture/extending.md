# Extending — adding a view, a local route, or a supervisor capability

The target architecture is direct-supervisor-first. Before adding any backend
route, decide who owns the capability:

- If it is GC-owned data or a GC-owned mutation, add or use a GC supervisor API
  endpoint and consume it through the generated browser supervisor client.
- If it is local dashboard evidence (`git`, `gh`, host/process/dolt-noms,
  build logs, client-error telemetry), add a dashboard-service `/api/*` route.
- If standalone development needs same-origin supervisor access, add a
  transport-only proxy. Do not add DTO mapping or field stripping to that proxy.

## Adding a new view

PR-A of the modular-dashboard PRD (`specs/requirements/modular-dashboard-prd.md`) introduced a registry-driven path for new views; legacy explicit-wiring still exists for routes that haven't been ported yet. Prefer the registry path for anything new.

A new view's UI and copy must follow `DESIGN.md`, the binding visual contract (see also the [module author checklist](module-author-checklist.md)).

### Registry-driven (preferred — PR-A onwards, /health is the worked example)

1. Add the route component under `frontend/src/routes/MyView.tsx`.
2. Add `frontend/src/views/modules/my-view.module.tsx` exporting a `FrontendViewDescriptor`. See `views/modules/health.module.tsx` — `lazy(() => import(...))` keeps the chunk out of the first-paint bundle.
3. Register it in `frontend/src/views/registry.ts` by adding to `ALL_VIEWS`.
4. If the view shows GC-owned data, add a hook/client wrapper over the generated
   supervisor client. If the view shows dashboard-local data, add
   `backend/src/views/modules/my-view.module.ts` exporting a `BackendModule<Deps>`
   and register it in `backend/src/views/registry.ts`. The iterator in
   `backend/src/app.ts` mounts it at `/api/<module-id>` automatically.

### Legacy (still the path for routes not yet ported)

1. Add the route component under `frontend/src/routes/MyView.tsx`.
2. Add the route in `frontend/src/App.tsx`.
3. Add the nav entry in `frontend/src/components/Header.tsx` — append to `EXPLICIT_ROUTES` with an `order` value that interleaves cleanly with the registry-driven entries.
4. If the view shows dashboard-local data the backend has to fetch + process,
   add a backend route under `backend/src/routes/myview.ts` and register it in
   `app.ts`. If the data is GC-owned, add it to the supervisor API instead.

## Adding a supervisor-backed feature

1. Check whether the supervisor OpenAPI already exposes the resource.
2. If it does, regenerate/update the browser supervisor client and consume the
   generated types directly from the frontend.
3. If it does not, update
   [`../gc-supervisor-api-gaps.md`](../gc-supervisor-api-gaps.md) and implement
   the endpoint/schema in `gastownhall/gascity`.
4. Add frontend tests against the generated-client wrapper or hook. Do not add a
   dashboard-server mirror route as the permanent fix.

## Adding a dashboard-local backend route

`backend/src/routes/foo.ts`:

```ts
import { Router } from 'express';
export function fooRouter(): Router {
  const router = Router();
  router.get('/', async (_req, res) => {
    // Local dashboard evidence only: git, gh, host, build log, telemetry, etc.
    res.json({ items: [...] });
  });
  return router;
}
```

Register in `server.ts`:

```ts
import { fooRouter } from './routes/foo.js';
// ...
writeRouter.use('/foo', fooRouter(gc));
```

The `writeRouter` mount already wraps routes in `csrfValidate` for
dashboard-service state-changing methods. GETs pass through. GC mutations
belong on the supervisor API and should not be routed through a dashboard-local
CSRF wrapper unless this is a temporary migration path with a deletion condition.

## Adding a new whitelisted exec command

**Every** privileged invocation MUST route through `backend/src/exec.ts`. There is no general-purpose exec helper outside that file.

Only add commands for local evidence the supervisor should not own, principally
`git` and `gh`. Do not add new `gc` subprocess wrappers; add or fix the
supervisor API instead.

To add a new command (e.g. a constrained `git` evidence query):

1. **Define the param schema.** What inputs are allowed? Bead-id, session-id, agent-alias — or pure literal command? Add a regex if it takes a parameter.
2. **Export a named wrapper** in `exec.ts`:

```ts
export async function execGitSomething(): Promise<ExecResult> {
  await acquireSlot();
  try {
    return await runExec('git', ['status', '--porcelain=v1'], 5_000);
  } finally {
    releaseSlot();
  }
}
```

3. **Wire it** in a route and `recordAudit({ type: 'dashboard.exec', endpoint, parsed_args, exit_code, duration_ms })`.

What you MUST NOT do:

- Don't pass user input into the args array without param-schema validation.
- Don't set `shell: true`.
- Don't inherit env (`runExec` already strips; if you bypass `runExec`, you carry the burden).
- Don't skip the audit log row.

## Adding a new shared type

Add shared types only for dashboard-owned service DTOs, UI/module contracts, or
local view models. Do not add shared mirrors for supervisor resources already
covered by generated OpenAPI types. If a supervisor shape is missing or
inaccurate, fix the supervisor OpenAPI source.

## Running just one workspace

```bash
npm --workspace backend run dev     # tsx watch, instant reload
npm --workspace frontend run dev    # vite, HMR on :5174
npm --workspace shared run build    # types only (build:shared also at root)
```

## Running the Peek-modal regression locally

`scripts/snap-peek.mjs --test` is the regression guard for the Peek modal — it
catches transparency regressions (the modal must render opaque against the
scrim, per `Modal.tsx`) and direct-supervisor transcript regressions (the
browser must fetch `/gc-supervisor/v0/city/<city>/session/<id>/transcript`,
not the deleted dashboard `/api/.../sessions/<id>/peek` mirror).

```bash
# Backend + frontend must both be up:
#   Terminal 1: npm run dev:backend
#   Terminal 2: npm run dev:frontend
node scripts/snap-peek.mjs --test
```

Exit codes:

- `0` and `peek regression: PASSED` — modal opaque, peek POST 200, all good.
- `0` and `peek regression: SKIPPED` — no frontend reachable, or no active
  sessions to peek. Not a failure, but you didn't actually verify anything.
- `1` and `peek regression: FAILED` — real regression. Check the per-theme
  `FAIL — ...` lines for which assertion blew (transparency, no peek POST,
  non-200 response, modal didn't open).

Without `--test`, the script behaves as a snap-only harness, same as the other
`scripts/snap*.mjs` files: writes PNGs to `/tmp/cp-snaps/` and exits 0.

## Modular-dashboard CI invariants (PRD §1, §7)

These checks document module-author conventions. PR-A only enforces the
`as never` ban in CI; the others are documented now so PR-B+ can turn them
on when `backend/src/views/modules/` becomes the home of more than one
module.

- **Enforced in PR-A:** `grep -rn 'as never' backend/src/app.ts` returns
  zero hits. The existential `bind<D>()` wrapper in `backend/src/views/types.ts`
  is the only sanctioned way to widen module Deps for iteration.
- **Pending enforcement (PR-C):** every file under
  `backend/src/views/modules/` reads from `ctx.cityName`/`ctx.cityPath`/
  `ctx.cityDataDir`, never from the global `config.cityName`/`config.cityPath`:
  ```
  grep -rn 'config\.cityName\|config\.cityPath' backend/src/views/modules/
  # must return zero hits
  ```
- **Pending enforcement (PR-C):** no module-level mutable singletons under
  `backend/src/views/modules/` — these are the SSE-registry / cache-Map
  patterns that premortem #2 flagged as multi-city-leak hazards:
  ```
  grep -rn '^const.*= new Set\|^const.*: Array\|^const.*: Map' backend/src/views/modules/
  # must return zero hits
  ```
- **Audience-hypothesis revisit (PR-A scheduled bead, PRD §7):** a
  `bd` task is created at PR-A merge with a 6-month target date. If the
  date passes with no `specs/requirements/PLUGIN-API-DEFERRED.md` tombstone AND the bead
  is still open, `scripts/check-audience-hypothesis-due.sh` exits 1.
  Not yet wired into CI — re-evaluate at PR-D land time.

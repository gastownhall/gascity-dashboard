# Maintainer coupling audit (pre-PR-B)

Written inventory of every cross-boundary touch Maintainer makes in the codebase as of `eaa14b8c`. This is the input the PRD §7 "Pre-PR-A: Maintainer coupling audit" gate requires before PR-B opens. Each entry has a `Disposition` so PR-B's implementer can resolve it deliberately rather than discovering it at typecheck-time.

**Disposition vocabulary:**

- `kept-inside-module` — the coupling stays internal to `backend/src/views/modules/maintainer/` (or the frontend twin). Nothing leaks out.
- `promoted-to-CityContext` — the dependency needs to surface through the new `shared/` contract. The "what to add" column names the field.
- `requires-PRD-revision` — the coupling does not fit the current contract and the PRD must change before the impl agent can land cleanly.
- `pre-existing-bug` — latent issue independent of modularization; flag for follow-up but do not block PR-B on it.

> Note: the PRD §7 bullet that described `raceWithTimeout` as coming from the old sessions route was corrected by PR-B1. `raceWithTimeout` now lives in `backend/src/lib/race-with-timeout.ts`, and the dashboard sessions read mirror has since been removed from the browser-facing request plane.

---

## C1. SSE singleton (`backend/src/views/modules/maintainer/sse.ts:15`)

- **What.** `const clients = new Set<Response>();` at module scope. `addSseClient`, `removeSseClient`, `notifyRefresh`, and `sendHeartbeat` are the only readers/writers, all closing over that Set. `backend/src/views/modules/maintainer/worker.ts:6` imports `notifyRefresh` and `sendHeartbeat`; `backend/src/views/modules/maintainer/router.ts:27` imports `addSseClient`, `notifyRefresh`, `removeSseClient` — both via the canonical `./sse.js` sibling path.
- **Risk.** If PR-B moves `sse.ts` under `backend/src/views/modules/maintainer/` and a test fixture (or any other call site) keeps importing the old path even by accident, the two ESM specifiers resolve to two separate module instances and therefore two separate `Set`s. The worker pushes into a dead registry while the SSE clients hang on the route's live one. Symptom is the snap harness or `Maintainer.test.tsx` SSE assertion timing out instead of seeing a `refreshed` event. This is precisely the failure class premortem #2 calls out.
- **Disposition.** `kept-inside-module`. The Set is correctly module-scoped to the maintainer module — it should stay inside the module's directory. PR-B's safety check is **a single canonical import path** for the SSE module after the move, enforced by the grep gate `grep -rn "^const.*= new Set" backend/src/views/modules/` returning zero hits (which it will, because `sse.ts` is the singleton — that file gets a `// module-allow: SSE client registry, owned by maintainer module` line-comment exemption per PRD §1 CI invariants). The PRD's PR-B1 acceptance also adds an SSE-roundtrip to the snap harness specifically to catch a singleton split.
- **Status (PR-B1):** RESOLVED. `sse.ts` moved into `backend/src/views/modules/maintainer/sse.ts`; the `// module-allow: SSE client registry is intentionally module-scoped per maintainer-coupling-audit.md C1` line-comment marker is in place above the `Set` declaration. Both consumers (router, worker) import via the canonical sibling path `./sse.js` — no stale `../maintainer/sse.js` import remains in the tree.

## C2. slung-state path derivation duplicated (`app.ts:109-112` and `routes/maintainer.ts:477-481`)

- **What.** `app.ts` computes `maintainerSlungStatePath = path.join(path.dirname(config.maintainerCachePath), 'slung-state.json')` and passes it into both `maintainerRouter` and `createMaintainerRefresher`. `routes/maintainer.ts` separately defines `defaultSlungStatePath(cachePath)` (same `path.dirname(cachePath) + 'slung-state.json'` formula) as the default for the `slungStatePath` option when callers omit it. Same value, two derivations, in two files.
- **Risk.** The PRD's `needs(config)` consolidation moves this derivation into the maintainer module's `needs` function — but if `routes/maintainer.ts`'s `defaultSlungStatePath` survives the move with a different base (e.g. derived from `ctx.cityDataDir` while the route still defaults from `cachePath`), the worker and the route can end up reading two different `slung-state.json` paths. The sling write goes one place, the worker purge runs the other, and slung entries appear to leak from the user's perspective.
- **Disposition.** `kept-inside-module`. PR-B should delete `defaultSlungStatePath` from `routes/maintainer.ts` entirely and require the caller (the module's `mount` function) to pass `slungStatePath` explicitly — derived once in `needs()` from `path.join(ctx.cityDataDir, 'slung-state.json')` per the PRD §1 worked example. Single source of truth.
- **Status (PR-B1):** RESOLVED. `defaultSlungStatePath` deleted from the router (now at `backend/src/views/modules/maintainer/router.ts`). `slungStatePath` is a REQUIRED option (no default); `app.ts`'s explicit mount still derives it from `path.dirname(config.maintainerCachePath)` for PR-B1 (the safety-net mount path), and the new `maintainerBackend.mount` (descriptor, not yet wired) derives it from `path.join(ctx.cityDataDir, 'slung-state.json')` for the PR-B2 registry path. The test suite (`maintainer-sling.test.ts`) passes `slungStatePath` explicitly to `buildApp`. Single source of truth at each entry point.

## C3. `raceWithTimeout` shared helper for the maintainer `listSessions` injection

- **What.** `app.ts` wraps `gc.listSessions()` with a 3s timeout before injecting the result into `maintainerRouter` as the `listSessions` option. The helper now lives in `backend/src/lib/race-with-timeout.ts`.
- **Risk.** If a generic timeout helper were exported from a route, modules would couple to a sibling feature's implementation path. That would violate the "low coupling" goal and create an import-path landmine for session read migration.
- **Disposition.** `promoted-to-CityContext`. Keep `raceWithTimeout<T>(p: Promise<T>, ms: number): Promise<T>` in a shared util location accessible to backend modules.
- **Status (PR-B1):** RESOLVED. Hoisted to `backend/src/lib/race-with-timeout.ts` (kebab-case to match `sanitise-error.ts` neighbour). The maintainer module descriptor (`maintainer.module.ts`) imports from there; the per-route timeout message text was generalised to "operation timed out after Xms" (no test was pinning the old "sessions route timed out" string). The browser-facing dashboard sessions mirror has since been deleted, so there is no remaining route-level owner for this helper.

## C4. `gc-client.ts:273` slung-state comment reference

- **What.** A JSDoc comment on `GcClient.sling()` describes the contract by referencing maintainer-specific bookkeeping: *"The caller reads `root_bead_id` off the response to record slung-state, in place of the old `^Slung <id>` stdout parse."*
- **Risk.** Comment-level leak only — no runtime coupling. But it indicates the supervisor client (a core seam) already encodes assumptions about a specific consumer (maintainer). When PR-A's adapter exposes `ctx.gc` as the raw `GcClient` per the PRD §1 CityContext comment, the next person reading `gc-client.ts` will see a maintainer-specific contract baked into the host-level class.
- **Disposition.** `kept-inside-module`. Rewrite the JSDoc to be consumer-agnostic: *"Callers read `root_bead_id` off the response to record their own routing state."* No code change. Land it inside PR-A so the seam is conceptually clean before PR-B touches the same area. (This is a one-line doc fix; do not let it grow into a refactor.)

## C5. `MaintainerRefresher` lifecycle shape vs `BackgroundWorker` (`maintainer/worker.ts:37-41`, PRD §1 `BackgroundWorker`)

- **What.** `MaintainerRefresher` is `{ readonly running: boolean; start(): void; stop(): void }`. The PRD's `BackgroundWorker` contract from `shared/src/views.ts` is `{ start(): void; stop(): Promise<void> }`. Two mismatches: (1) extra `running` getter, (2) `stop()` returns `void`, not `Promise<void>`.
- **Risk.** The mismatch surfaces only when the registry-iterator code in `app.ts` (PR-B2) tries `await worker.stop()` and gets `undefined` synchronously — TypeScript will accept it (awaiting a non-Promise is legal), so it slips past `typecheck` but is caught by `typecheck:test` only if a test asserts the Promise contract. More importantly, if any future module's `stop()` does real async cleanup, the registry can't tell who actually finished — silent shutdown race.
- **Disposition.** `promoted-to-CityContext`. The PRD's PR-A scope already includes *"Adapts MaintainerRefresher to `BackgroundWorker` shape so PR-B has a typed target"* (§7 PR-A row). Implementation needs: (a) `stop(): void` → `async stop(): Promise<void>` returning a resolved promise after `clearTimeout`/`clearInterval`; (b) drop the `running` getter from the public interface (keep as internal state if useful for tests). The `BackgroundWorker` interface lives in `shared/src/views.ts` per PRD §1. No PRD change needed — this is exactly what the PRD asks for.
- **Status (PR-B1):** RESOLVED in PR-A; PR-B1 verified. `MaintainerRefresher` extends `BackgroundWorker` from `gas-city-dashboard-shared` (`worker.ts:43`); `stop(): Promise<void>` returns a resolved promise after timer cleanup; the `running` getter is retained as a Maintainer-specific introspection surface (the public PR-A interface comment documents the forward-compatibility shape). The moved `worker.ts` still imports `BackgroundWorker` from `gas-city-dashboard-shared` (not from the backend `views/types` alias) per the wave instruction.

## C6. Maintainer-specific env vars in `AdminConfig` (`backend/src/config.ts:38-85`)

- **What.** `AdminConfig` carries `maintainerRepo`, `maintainerCachePath`, `maintainerRefreshIntervalMs`, `maintainerSlingTarget`, `maintainerTriageTarget`. PRD §2 says modules own their config slice via `needs(config)`.
- **Risk.** PRD says modules consume their slice via `needs`. That's fine for the read side — `maintainerBackend.needs(config)` reads exactly these fields. But `AdminConfig` keeps holding maintainer-shaped state at the host level, which means a `MODULES_ENABLED` that excludes maintainer still parses `MAINTAINER_*` env vars at boot. Not a correctness bug, but it leaves the host-level config type knowing about an opt-in module's surface in perpetuity.
- **Disposition.** `kept-inside-module` (for PR-B). PRD does not require moving these fields out of `AdminConfig` in Phase 1, and tightening the type now would force every test that constructs an `AdminConfig` to change. Flag as a Phase-1.5 follow-up: introduce `AdminConfig.modules: Record<string, unknown>` parsed by each module's own env-loader, then deprecate the maintainer-prefixed fields. **Open a `bd ready` bead** for this so it doesn't slip; reference it from the PR-B body.
- **Status (bead gascity-dashboard-nged):** RESOLVED without the full type-generalization. `loadConfig` now gates the maintainer slice on `maintainerEnabled` (`config.ts`): a disabled maintainer gets an inert `defaultMaintainerModuleConfig()` and the host reads **none** of its `MAINTAINER_*` env (no deprecation warn fires either). The `AdminConfig.modules.maintainer` field keeps its non-optional type — the slice is always present but inert when disabled — so no `AdminConfig`-constructing test had to change; only the `loadConfig` tests that exercise the env loader added `MODULES_ENABLED=maintainer`. The generic `modules: Record<string, unknown>` refactor remains a deferred, optional cleanup, not a correctness need.

## C7. In-process refresher wired through host lifecycle (`app.ts:139-165`)

- **What.** `app.ts` constructs `createMaintainerRefresher(...)` at lines 143-148 and adds `.start()` / `.stop()` to the host runtime's `start()`/`stop()` callbacks. The host therefore knows about the maintainer worker by name.
- **Risk.** When PR-B2 wires modules through the registry iterator (PRD §2), every module's `workers()` output goes into the same `workers: BackgroundWorker[]` array that `app.ts` iterates for `start()`/`stop()`. If the relocation drops the worker registration silently (e.g. `workers` is undefined because the module guards on a non-existent env), the refresher never runs and the cache stops updating — and there's no boot-time loud signal that anything is wrong. The current code at least has the explicit `refresherState.status === 'active'` branch that's grep-able.
- **Disposition.** `kept-inside-module`. PRD §2 puts the iterator logic in `app.ts` (the loop at lines 275-281 of the PRD). PR-B2 acceptance should add a `logInfo(LOG_COMPONENT.admin, `module=${bound.id} worker=${w ? 'started' : 'skipped'}`)` line inside the loop so the boot log makes the registration outcome obvious for every module. Not a PRD change — call it a recommendation in the PR-B2 description.

---

## Additional couplings found

### C8. `DashboardRuntimeConfig.githubRepo` is sourced from `config.maintainerRepo` (`app.ts:79`, `shared/src/snapshot/types.ts:48`)

- **What.** The shared `DashboardRuntimeConfig` wire shape has a `githubRepo: string` field, populated at `app.ts:79` from `config.maintainerRepo`. This field is consumed by `frontend/src/api/client.ts` (`config()` route) and by `frontend/src/routes/AmbientHome.tsx`/`Workflows.tsx` (per the test fixtures). The semantic intent ("the GitHub repo for *this* dashboard") sits at the host level but its **value is whatever the maintainer module's env says**.
- **Risk.** When PR-D ships with `MODULES_ENABLED` defaulting to NOT include maintainer, the host still reads `MAINTAINER_REPO` to populate `DashboardRuntimeConfig.githubRepo`. Two failure modes: (a) operator deploys without maintainer enabled, never sets `MAINTAINER_REPO`, gets the default `'gastownhall/gascity'` echoed back to the frontend as "this is your repo" — visibly wrong. (b) operator deploys with a different repo in mind, sets `MAINTAINER_REPO` thinking it only affects the (disabled) maintainer module, but it actually shows up in AmbientHome/Workflows too.
- **Disposition.** `requires-PRD-revision`. The PRD currently doesn't address this. Either: (i) split `DashboardRuntimeConfig.githubRepo` off into a host-level `GITHUB_REPO` env (since core views — AmbientHome, Workflows — read it), and have the maintainer module's `needs()` default `repo` from `config.githubRepo` falling back to its own `MAINTAINER_REPO`; or (ii) declare that `githubRepo` is maintainer-owned, remove it from `DashboardRuntimeConfig`, and have AmbientHome/Workflows source it via a different mechanism (their own descriptor `needs`, or a `homeContribution`). The PRD should pick one and document it in §4 before PR-D ships. **This is load-bearing and the main session must incorporate the revision before PR-D's default flip merges.**
- **Status (bead gascity-dashboard-nged):** RESOLVED via option (ii). `githubRepo` is no longer on the `DashboardRuntimeConfig` wire shape — it lives solely on the maintainer module's config slice (`config.ts` `MaintainerModuleConfig.githubRepo`), read only by `maintainerBackend.needs()` and consumed only inside `Maintainer.tsx` (`data.repo`). With PR-D's core-only default the module isn't bound, so `needs()` never runs and the repo never reaches the frontend — neither failure mode (a) nor (b) can occur on a default install. The gated-parse fix above additionally stops the host from even reading `MAINTAINER_REPO` when the module is disabled.

### C9. `frontend/src/components/Header.tsx:19` hardcodes the Triage nav entry

- **What.** `Header.tsx` has a hardcoded `{ to: '/maintainer', label: 'Triage' }` entry in the `ROUTES` array. `App.tsx:12, 40` similarly hardcodes the import and `<Route path="/maintainer" ... />`.
- **Risk.** This is exactly what PRD §3 (Frontend module mounting) replaces — descriptor-driven `ROUTES` and `<Routes>`. Surfaced here for completeness so the audit lists it explicitly.
- **Disposition.** `kept-inside-module`. PR-B1 relocates `Maintainer.tsx` and exports a `maintainerView: ViewDescriptor` per the PRD §3 worked example; `Header.tsx` and `App.tsx` shift to descriptor-iterating. No PRD change.

### C10. Snap harness has hardcoded `'maintainer'` route (`scripts/snap.mjs:22`)

- **What.** `const ROUTES = ['agents', 'beads', 'workflows', 'mail', 'activity', 'health', 'maintainer'];` — the snap harness assumes maintainer is mounted in the running dashboard.
- **Risk.** Once PR-D flips the default to exclude maintainer, the snap harness's iteration over `ROUTES` will hit a 404 / "Module unavailable" route for `/maintainer` and either fail or capture a misleading screenshot. The harness needs to either (a) read enabled modules from `/api/config` first and filter, or (b) keep maintainer in `ROUTES` and require devs to enable it before snapping.
- **Disposition.** `kept-inside-module`. Update `snap.mjs` in PR-D alongside the default-flip — fetch `/api/config.enabledModules` and intersect with `ROUTES`. Cite this in the PR-D checklist.

### C11. `backend/src/exec.ts` (`AGENT_ALIAS_RE`, `execGhIssueList`, `execGhPrList`, `ExecError`) — host helpers used by maintainer

- **What.** The maintainer subtree (`maintainer/triage.ts`, `maintainer/contributor.ts`, `maintainer/worker.ts`, `routes/maintainer.ts`) imports `AGENT_ALIAS_RE`, `ExecError`, `execGhIssueList`, `execGhPrList` from `../exec.js`.
- **Risk.** These are host-level privileged helpers. Per PRD §4 capability table, `kind: 'firstParty'` modules retain access to `exec.ts` privileged helpers, so this coupling is expected and contracted. Risk is purely path-stability on relocation — the relative-import depth changes when the module moves into `backend/src/views/modules/maintainer/`.
- **Disposition.** `kept-inside-module`. Mechanical fixup during PR-B1 file moves. No design change.

### C12. CSRF / Origin posture parity

- **What.** Audited `routes/maintainer.ts` for any deviation from the host CSRF/Origin posture. None found — the maintainer router is mounted under the shared `writeRouter` (`app.ts:113-127`) which applies `csrfValidate` uniformly, and the `/events` SSE GET is correctly exempt via `csrfValidate`'s GET pass-through (confirmed by the comment at `routes/maintainer.ts:208`).
- **Risk.** None. After PR-B2 the registry iterator wires the module's router into `writeRouter` (PRD §2 line 278), so the CSRF posture is preserved by construction.
- **Disposition.** `kept-inside-module`. No action.

### C13. `MAINTAINER_*` env references in non-maintainer files (`backend/src/exec-core.ts:33`)

- **What.** `backend/src/exec-core.ts:33` has a comment-only reference to `MAINTAINER_SLING_TARGET` / `MAINTAINER_TRIAGE_TARGET`. No runtime use.
- **Risk.** Stale comment if the env-var names change as part of C6's follow-up. Easy miss in grep cleanup.
- **Disposition.** `pre-existing-bug` (cosmetic). Rewrite or delete the comment opportunistically; do not block PR-B on it.

---

## Summary

Total couplings: **13**. Distribution: **9 kept-inside-module / 2 promoted-to-CityContext / 1 requires-PRD-revision / 1 pre-existing-bug.**

**The one `requires-PRD-revision` is C8** (`DashboardRuntimeConfig.githubRepo` sourced from `config.maintainerRepo`) — the PRD does not currently address what happens to this wire-shape field when maintainer is disabled, and AmbientHome/Workflows depend on it. The main session must update the PRD (most likely §4 "Stays core" or a new entry in §7) before PR-D's default flip ships, so the host knows where to source `githubRepo` when no maintainer module is enabled.

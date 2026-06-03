# Code Quality Remediation Plan

Status: reset on 2026-06-01 to a clean branch from `origin/main` for a spec-first architecture pivot. The new target is to make this project the eventual replacement for the built-in `gc dashboard` by using the GC supervisor API directly from the browser for every GC-owned capability the supervisor can expose. The custom dashboard service remains only for dashboard-local capabilities that do not belong in the supervisor API, principally `git`, `gh`, local build/log evidence, host health, client-error telemetry, and any temporary transport-only proxy needed for same-origin development. This supersedes the previous permanent "backend mirrors supervisor DTOs into dashboard `/api/*`" direction. This plan is the synthesis of two independent review passes against `main` (clean working tree, ~31k LOC of non-test source), plus the direct-supervisor replacement decision:

1. **Thermo-nuclear review (TN)** — 8 parallel slice reviewers auditing the whole codebase for abstraction quality, god-files, spaghetti growth, and canonical-helper drift.
2. **Codex remediation prompt (claims A–H)** — validated claim-by-claim against the actual source by 8 verifier agents. Each verdict below carries file:line evidence.

Every item in this plan is **evidence-backed and validated**. Where the two passes overlap they are merged; where Codex was imprecise the correction is called out.

### 2026-06-01 architecture reset — direct supervisor first

The upstream `gascity` dashboard is the better architectural reference: its SPA is generated from and calls the supervisor OpenAPI directly, while the Go side serves the static bundle. This dashboard should converge on the same ownership model rather than preserving a second server-side GC API facade.

**New boundary:**

- **GC-owned reads/writes:** browser calls a generated GC supervisor client for sessions, agents, beads, mail, events, health, cities, formula feeds, formula run snapshots, claim/close/nudge/send operations, and any future GC primitive once it exists in supervisor OpenAPI.
- **Dashboard service:** serves the SPA and exposes only capabilities the supervisor should not own: `git` diffs/logs, `gh` maintainer triage, local deploy/build logs, host/process/dolt-noms health, audit/client-error telemetry, and optional transport-only proxying. A transport proxy may forward bytes for same-origin/CSP/SSH convenience, but it must not own DTO mapping, validation, field stripping, cache semantics, or product vocabulary translation for GC resources.
- **Missing GC capability:** add it to [`../gc-supervisor-api-gaps.md`](../gc-supervisor-api-gaps.md) and implement it upstream in `gastownhall/gascity`; do not compensate by growing permanent dashboard-server GC adapters.
- **Dashboard-owned view models:** client hooks/selectors may derive display state from generated supervisor types, and the dashboard service may still expose local DTOs for `git`/`gh`/host-only resources. `shared/` should shrink toward dashboard-service DTOs and UI/module contracts, not mirror supervisor wire types.

**Claude feedback revalidated under this boundary:**

- **P1 #1 (`GcClient` duplication) is valid but the better fix is deletion.** The prior descriptor-table cleanup would make `GcClient` less bad; direct supervisor use removes most of `GcClient`, its cache-key drift risks, and its route-specific adapter surface. Any remaining server-side supervisor use should be transitional or server-only.
- **P1 #2 (`workflow_id → run_id`, semantic identity, vocab maps) remains valid for composed Formula Run Detail.** Prefer upstream supervisor presentation fields or a shared Gas City presentation package where possible; keep dashboard-local transforms small and client-side until those gaps close.
- **P1 #3 / P2 #4 / P2 #5 / P4 remain valid local code-quality work.** Run-health state, phase/formula tables, route view-state hooks, and frontend list-shell reuse are still useful after direct-supervisor migration.
- **P3 #6 changes disposition.** It correctly identified a broken contract boundary, but schema-hardening common GC list DTOs is now the wrong long-term work. The direct-supervisor client should consume generated supervisor types and generated/runtime validation from OpenAPI. Shared runtime schemas remain appropriate for dashboard-owned `git`/`gh`/host/local composed DTOs only.
- **P3 #7 remains valid for dashboard-owned absence envelopes.** Do not normalize supervisor domain booleans just to satisfy a dashboard idiom.
- **P5 quick wins should be rechecked after reset.** The serial run-detail fetch and dead resolver are still likely valid if the corresponding backend route remains during migration; if the route is deleted by direct-supervisor work, do not spend time polishing it first.

**Simplification estimate from current `origin/main`:**

- Likely removable production code after migration: about **3.8k-5.4k LOC** net.
- Direct candidates: `backend/src/gc-client.ts` (~1,009), `backend/src/gc-supervisor-decoders.ts` (~920), GC proxy routes for agents/beads/mail/sessions/events/session-stream/snapshot/large parts of runs (~1.4k-2.0k), supervisor mirror DTO leaves in `shared/src/gc-*.ts` and `shared/src/formula-runs.ts` (~650), and much of `frontend/src/api/client.ts` (~250-350 net after a small dashboard-service client remains).
- Tests and fixtures should shrink further, likely **4k-7k LOC**, because route-level mocks for mirrored supervisor endpoints disappear and component tests can mock the generated supervisor client at the browser edge.
- Reliability improves by removing one network hop and one semantic translation layer. The biggest concrete wins are fewer DTO drift failures, no server-side field stripping to maintain, no duplicated list partial metadata, fewer cache-key/query divergence bugs, less local stale-cache behavior, and fewer "generated OpenAPI type → hand Zod → shared DTO → frontend decoder" disagreement cases. Remaining risks move to the correct owner: supervisor OpenAPI accuracy, browser-safe supervisor transport, and upstream API gaps.

See the focused migration plan in [`direct-supervisor-client-migration.md`](direct-supervisor-client-migration.md).

### 2026-06-01 full-codebase review update

This update folds in the current full-codebase thermo-nuclear review plus the validated parts of `tmp/claude-feedback-01.txt`. Several Claude findings were already solved by earlier workstreams (`WS-5`, `WS-9`, `WS-11`, `WS-12`, `WS-13`, `WS-14`), so they are not duplicated below. The remaining validated issues are promoted into new current workstreams:

- **`GcClient` still needs a real diet, but deletion is now preferred.** The generated SDK cutover happened, but `backend/src/gc-client.ts` still repeats request/query/cache-key templates. See `WS-15` for the validated smell and `WS-29` for the architectural replacement.
- **Dashboard and supervisor runtime boundaries are still split.** Generated supervisor validation exists, but the dashboard server still mirrors GC resources into `/api/*`. This is now treated as migration debt, not a boundary to preserve. See `WS-10`, `WS-16`, `WS-17`, and `WS-29`.
- **Concrete behavior bugs remain in action/transport wrappers.** Bead close and agent nudge are conflated, and mail filtering pretends upstream supports filters it ignores. See `WS-18` and `WS-19`.
- **Build/test guardrails miss real hazards.** Shared tests are not typechecked by the root gate, shared test execution is hardcoded to two files, and ignored `dist` output can retain deleted modules. See `WS-20` and `WS-21`.
- **Small but real mutation/deletion work should land while nearby code is touched.** `RunNodeSessionPanel` sorts DTO arrays in place, `selectOneMark` still carries comment archaeology, and `module.resources` remains required scaffolding with no current consumer. See `WS-22` and the lower-priority cleanup list.

Follow-up validation of Claude's P1-P5 feedback against the current worktree produced these corrections:

- **Claude P5 quick wins split into true / stale / unsafe.** `resolveRunFormulaName` was still test-pinned dead code and run-detail sessions/formula-detail lookups were still serial; both are now fixed in `WS-23`. The proposed `selectOneMark` parent-transfer deletion is **not safe** because current tests pin merged-PR parent transfer behavior. The proposed `module.resources` deletion is **stale** because `bind()` now validates the resource contract and maintainer declares real cache/slung-state resources.
- **Claude P1 #2 remains partly valid.** In-flight PR detection is already centralized, but mark application still runs in separate compose/overlay paths. `workflow_id → run_id`, step-ref semantic identity, and `ralph → check-loop` mapping still have multiple local implementations. See `WS-24`.
- **Claude P1 #3 and P2 #4 remain valid.** Run-health cross-cycle state still lives in `snapshot/service.ts`, and phase/formula classification is still ordered branching where tables would encode precedence. See `WS-25` and `WS-26`.
- **Claude P2 #5 / P4 frontend decomposition remains valid but should be incremental.** `useFormulaRunDetail` exists, but `FormulaRunDetail.tsx` and `AgentDetail.tsx` still compose several fetch and view-state machines inline; list routes repeat a shared shell. See `WS-27` and lower-priority cleanups.
- **Claude P3 #6 / #7 remain valid with revised scope.** The API-client boundary problem is real, but common session/agent/bead/mail DTO schemas are superseded by direct generated supervisor usage. Shared runtime schemas should cover dashboard-owned local/composed DTOs only. `Avail<T>` is already canonical for list absence, but `DoltNomsTrend` still uses a parallel `available` boolean envelope; supervisor domain booleans such as `GcAgent.available` are not part of this cleanup. See `WS-16`, `WS-28`, and `WS-29`.

The open decisions were resolved in a `/grill-me` session against the architecture specs and the upstream `gascity` dashboard as a reference (`~/code/gastownhall/gascity/cmd/gc/dashboard/web`), then tightened by the explicit product directives that this app has **no backwards-compatibility obligation** to old dashboard routes or backend DTOs and that the GC supervisor API client should be **generated from OpenAPI as completely as the tooling allows**. See **Resolved decisions** at the end; the affected workstreams (WS-1, WS-2, WS-10, WS-12) reflect the final calls.

## Guardrails (non-negotiable)

These bound every workstream. They come from `AGENTS.md`, the architecture-best-practices block in `CLAUDE.md`, and the Codex prompt.

- **Product language is Formula / Run / Formula Run.** `workflow` may remain where it is literally the GC supervisor wire contract, generated supervisor type vocabulary, Gas City graph metadata, a literal metadata key such as `pr_review.workflow_formula`, GitHub Actions naming, or archived historical planning material. Translate at the dashboard edge; never let `workflow` flow into dashboard-owned DTOs, routes, components, tests, scripts, or CSS.
- **Move-fast-and-break-it.** No legacy redirects, no backward-compat shims, no deprecation aliases unless the GC supervisor wire API itself requires them. The dashboard frontend is the only consumer of this backend service, so `/api/*` DTOs and browser routes may break and rename as needed.
- **Use the GC supervisor API directly wherever possible.** Endpoint paths, request/response types, SDK calls, and runtime response validators should come from OpenAPI generation. For GC-owned resources the browser client should use that generated supervisor surface directly, modeled on the upstream `gascity` dashboard. Hand-written dashboard code at that boundary is limited to transport setup, UI view-model derivation, and temporary migration glue. Do not preserve duplicate hand-written endpoint maps, path builders, response mirrors, schema extractors, validators, or backend DTO stripping once generated equivalents and upstream API gaps exist.
- **Do not hand-edit generated code.** Change OpenAPI inputs / generator config / source modules and regenerate.
- **TDD.** Write or update the test first (or alongside). A change is not done until red→green. Static warnings count as failures.
- **Behavior-preserving by default except where breakage is intentional.** WS-1 intentionally turns old dashboard routes into 404s; WS-2/WS-10 intentionally break dashboard-owned DTO names at the translation edge instead of aliasing old names; WS-12 intentionally changes run-detail interaction behavior; WS-13 intentionally surfaces previously-hidden failures. Everything else should preserve behavior while deleting drift.
- **Match CI locally before pushing:** run the CI-equivalent gate in this plan, including shared tests and generated-supervisor drift checks. A `shared` dashboard DTO change breaks `*.test.ts(x)` fixtures the app typecheck never sees.

## Validation summary

| Claim | Title | Verdict | Disposition | Workstream |
| --- | --- | --- | --- | --- |
| A | `/workflows` + `/kanban` redirects exist; delete them | **partial** (redirects exist `App.tsx:80-84`; spec already forbids them; safe to delete) | include as-stated | WS-1 |
| B | Dashboard-owned `workflow` types/fields → run vocab | **confirmed** | include as-stated | WS-2 |
| C | Formula identity resolution duplicated 6× | **confirmed** (some divergence is *intentional*) | include **modified** | WS-5 |
| D | Run scope parsed in 5 places; 1 true duplicate | **confirmed** | include as-stated | WS-6 |
| E | `snapshot/collectors/runs.ts` (878 LOC) does too much | **confirmed** | include **modified** (after C, D) | WS-8 |
| F | Supervisor schema authority split; write-edge casts | **confirmed** | **redesigned** → generate client+Zod from OpenAPI (`@hey-api`); see WS-10 | WS-10 |
| G | Split detail/diff resources; honest diff errors; decouple tab | **confirmed** | **accepted in full** (split hooks + decouple tab); see WS-12 | WS-12 |
| H | Diff reviewability policy split across `exec.ts` + `diff.ts` | **confirmed** (genuinely cross-file) | include as-stated | WS-7 |

Additional **TN-only** findings not in the Codex prompt are folded in as WS-3, WS-4, WS-9, WS-11, WS-13, WS-14, plus the lower-priority cleanups list.

---

## Workstreams

Each workstream lists: **Why** · **Evidence** (file:line) · **Change** · **Tests** · **Risk** · **Deps**. Workstreams are grouped by tier; the tier is the recommended execution order.

### Tier 0 — Vocabulary isolation (low risk, high signal; do first)

#### WS-1 — Delete the dashboard `/workflows` and `/kanban` route surface  *(Codex A)*

- **Implementation status (2026-05-31):** Complete. `/workflows` and `/kanban` now hit the not-found route, the unused `legacyPaths` descriptor field is gone, and docs and tests were updated to reflect no legacy aliases.
- **Why:** Product language is Run/Formula. The dashboard owns no `workflow` routes per `specs/architecture/formula-run-detail-type.md:63,472`, yet `App.tsx` still ships client-side redirects — a documentation-vs-implementation divergence keeping the dead concept alive.
- **Evidence:** `frontend/src/App.tsx:80-84` — `<Route path="/workflows" element={<Navigate to="/runs" replace />} />` and the same for `/kanban` (SPA client redirect, not an HTTP 302). `shared/src/views.ts:69-70` — a `legacyPaths` redirect field that is **defined but never used** by any module.
- **Change:**
  1. Delete the two `<Route>` redirects and the explaining comment in `App.tsx`.
  2. Delete the unused `legacyPaths` field from the view-registry type in `shared/src/views.ts` (no module declares it → dead contract).
  3. Update the contracts that still teach the deleted field/routes: `specs/requirements/modular-dashboard-prd.md` (`legacyPaths`, `/workflows` core-route examples), `specs/architecture/module-author-checklist.md` (`legacyPaths?`), and any stale `/workflows` references in non-archived docs. No redirect compatibility remains.
- **Tests:** Add a route test asserting `/workflows` and `/kanban` render the not-found surface (not a redirect to `/runs`); confirm `/runs` still works. Verify no `<Link>`/`navigate()` in `frontend/src` targets these paths (grep clean today).
- **Risk:** Intentional route break. Old bookmarks now 404 — correct per spec and no-backcompat directive.
- **Deps:** none.

#### WS-2 — Rename dashboard-owned `workflow` types/fields to run vocabulary  *(Codex B)*

- **Implementation status (2026-05-31):** Complete for the dashboard DTO surface covered here. Supervisor wire payloads still use `workflow_id`, but backend decoders normalize them to dashboard `run_id`; tests pin that edge mapping and the maintainer triage `run_id` field.
- **Why:** The `workflow → run` translation is applied at only ~half the wire edge, so the dashboard interior speaks two dialects for one concept. AGENTS.md mandates translating at the edge, and there is no need to preserve old dashboard field names for external clients.
- **Evidence (rename — dashboard-owned leaks):**
  - `shared/src/run-detail.ts:202,205` — `WorkflowFormulaSource` → **`RunFormulaSource`** (consumed by `backend/src/runs/formula-name.ts:1,17` and `frontend/src/routes/FormulaRunDetail.tsx:250`).
  - `shared/src/index.ts:649` — `GcFormulaRun.workflow_id` → **`run_id`**.
  - `shared/src/index.ts:693` — `GcFormulaRecentRun.workflow_id` → **`run_id`**.
  - `shared/src/index.ts:1038` — `TriageItem.workflow_run_id` → **`run_id`** (stamped at `backend/src/views/modules/maintainer/router.ts:546`, read at `frontend/src/views/modules/maintainer/TriageSignals.tsx:39,43`).
- **Evidence (keep — genuine wire):** `gc-client.ts:86` endpoint path `/v0/city/{city}/workflow/{workflow_id}`; `gc-supervisor-decoders.ts:50-51,299-300,347,362` raw Zod schemas mirroring OpenAPI `WorkflowSnapshotResponse`/`FormulaRunResponse`. These stay `workflow_*`.
- **Change:** Rename the four dashboard-consumed symbols with no deprecated aliases. **Critically:** until WS-29 sheds raw `Gc*` wire mirrors from `shared`, `GcFormulaRun`/`GcFormulaRecentRun` are *decoder output* shapes even though the supervisor wire sends `workflow_id`; remap at the edge (`workflow_id → run_id`) and update the propagation site `snapshot/collectors/runs.ts:808` (`run.root_bead_id ?? run.workflow_id`). WS-29 later replaces these temporary shared feed mirrors with generated supervisor types consumed directly by the browser plus dashboard-local view models, so do not introduce long-lived compatibility names. Also fix the `TriageItem` field JSDoc, which points at the **deleted** `/workflows/<id>` route (`index.ts:1026`) → `/runs/<id>`. **Field name is `run_id`** (resolved — spec Naming Boundary L62 "Dashboard DTO identity is runId"; the "best-known-at-sling-time, not live" nuance stays in the JSDoc, not the name).
- **Tests:** Update `backend/src/views/modules/maintainer/maintainer-sling.test.ts` (asserts `workflow_run_id` stamping ~799-876), `frontend/src/views/modules/maintainer/TriageSignals.test.tsx`, `backend/test/gc-client.test.ts`, `backend/test/snapshot-runs.test.ts`, and `shared/src/index.test.ts`. Add a decoder/edge test proving supervisor wire `workflow_id` maps to dashboard `run_id`.
- **Risk:** `shared` is currently the cross-workspace dashboard contract → run the full validation gate. The `TriageItem.workflow_run_id` JSDoc carries "best-known-at-sling-time" semantics — preserve that meaning in a one-line comment on the renamed `run_id`.
- **Deps:** none (but conceptually pairs with WS-5/WS-6 which finish the same translation in logic).

---

### Tier 1 — Quick-win de-duplication (low risk; reverses drift and deletes lines)  *(TN review)*

#### WS-3 — Reuse the canonical clock / format / tone / error helpers

These are pure deletion-via-reuse. Each fork has **drifted into a user-visible inconsistency**, so fixing them removes bugs, not just lines.

- **Implementation status (2026-05-31):** Complete. Route-local clocks now use `useNow()`, maintainer date/relative-time forks use canonical helpers, bead status tone is centralized at `StatusBadge`, and repeated API-error formatting is centralized in `api/client.ts`. Focused tests pin the 24h age boundary and bead status tone mapping.
- **Clock (`useNow`) — 6 routes reintroduce a banned anti-pattern.**
  - **Why/Evidence:** `frontend/src/contexts/NowContext.tsx` is mounted app-wide (`App.tsx:54`) and its own header comment names per-hook intervals as "the explicit anti-pattern flagged in the Phase 1 review." Yet `Mail.tsx:60-61`, `Agents.tsx:142,157`, `Activity.tsx:21-22`, `AgentDetail.tsx:60,115`, `Runs.tsx:63,68`, and `FormulaRunDetail.tsx:87-93` each run their own `useState(Date.now())` clock — and `FormulaRunDetail` hand-rolls a raw `setInterval` + `document.hidden` guard, re-implementing `useVisibleInterval`.
  - **Change:** Delete all six clock pairs → `const now = useNow()`. If a route needs a coarser cadence, that's a `NowContext` granularity prop, not a sixth timer.
- **Date/time formatters — forked and drifted (48h vs 24h).**
  - **Why/Evidence:** `lib/format.ts:7,14` (`formatDate`, `formatDateTime`) and `hooks/time.ts:30` (`formatRelative`) are unit-tested canonical helpers. `Maintainer.tsx:641,648,653` and `TriageSections.tsx:535` re-implement them — `formatRelative` forks roll to days at **48h** vs the shared **24h**, so the same screen renders ages by two grammars.
  - **Change:** Delete the four local helpers; import the shared ones. Thread `useNow()` in as the explicit `now` arg (also fixes the never-re-ticking-age staleness in the forks).
- **`beadStatusTone` — same bead, different color in body vs list.**
  - **Why/Evidence:** `components/BeadBody.tsx:182-194` maps `open → warn`; `routes/Beads.tsx:488-500` maps `open → neutral`.
  - **Change:** One exported `beadStatusTone(status)` next to `StatusBadge` (which owns `StatusTone`/`TONE_*`). Pick the correct mapping once; delete both.
- **`ApiClientError` formatting ladder — re-rolled 4×.**
  - **Why/Evidence:** `Beads.tsx:82`, `AgentDetail.tsx:214,411` each re-implement `err instanceof ApiClientError ? ... : err instanceof Error ? ...` while the shared `errorMessage()` is ignored.
  - **Change:** Promote one `formatApiError(err): string` (and `apiErrorParts(err)` for the structured case) into `api/client.ts` next to `ApiClientError`; all sites call it.
- **Tests:** Existing `format.test.ts` / `time.test.ts` cover the canonical helpers; add component assertions that maintainer ages and bead tones now match the rest of the app. Pick the 24h vs 48h grammar deliberately and lock it.
- **Risk:** None structural; verify the chosen `formatRelative` boundary is the intended one before deleting the 48h forks.
- **Deps:** none.

#### WS-4 — One partial-list predicate + one degraded-source notice

- **Implementation status (2026-05-31):** Complete. Backend routes now share `isPartialList`/`partialReasonsFromList`/`formatPartialErrors`; Agents and Runs use one `PartialDataNotice` component for degraded-source warnings.
- **Why:** The "is this supervisor list degraded?" check is product-critical (drives the partial badge) and is hand-duplicated; a comment at `routes/runs.ts:168` records it was **lost once in the workflow→run rename and had to be restored**.
- **Evidence (backend):** `routes/runs.ts:171`, `routes/links.ts:117,128` all repeat `list.partial === true || (list.partial_errors?.length ?? 0) > 0`. **Evidence (frontend):** `Agents.tsx:351-359` and `Runs.tsx:154-162` duplicate the `role="status"` "X partial" banner (the Runs comment at `:80` says "Mirrors the roster-partial signal in Agents.tsx").
- **Change:** Backend — `isPartialList(list)` + `partialReasonsFromList(list)` in a shared `lib/` module (pairs with `formatPartialErrors` from `links.ts:149`). Frontend — a tiny `<PartialDataNotice show title>` warn-toned `role="status"` component.
- **Tests:** Unit-test the predicate; component test the notice; keep existing route partial-path coverage green.
- **Risk:** Low. This is the canonical-helper extraction the prose comments are groping toward.
- **Deps:** none. (Conceptually overlaps WS-13's error-honesty theme.)

---

### Tier 2 — Canonical resolvers & policy (medium risk; unblocks Tier 3 splits)

#### WS-5 — Canonical run-formula identity resolver  *(Codex C — include modified)*

- **Implementation status (2026-05-31):** Complete. `resolveRunFormulaIdentity(mode, input)` centralizes formula name/source/target resolution for route/detail/state/lane consumers while preserving the intentional mode differences (`gc.formula_name` route precedence, formula-detail-before-title state precedence, and `mol-`-only lane title fallback).
- **Why:** Formula name/source/target is resolved in **6 places** with divergent precedence, kept in sync by ~40 lines of prose. The UI can disagree with itself about the same run.
- **Evidence (the 6 ladders, verbatim from validation):**
  1. `runs/formula-name.ts:59-74` `resolveRunFormulaName` — NAME: `gc.formula → title` (gated on `gc.formula_contract='graph.v2' && gc.run_target && !closed`).
  2. `runs/formula-run.ts:208-210` `runFormula` — NAME: `gc.formula → gc.formula_name → null`.
  3. `runs/formula-run.ts:216-238` `runFormulaState` — NAME: `runFormula() → formulaDetail?.name → resolveRunFormulaName()`.
  4. `runs/formula-run.ts:240-256` `runFormulaDetailState` — NAME: `runFormula(root) → formulaDetail?.name`.
  5. `routes/runs.ts:120-124` `getRunFormulaDetail` — NAME: `(source==='metadata' ? resolved.name) → gc.formula_name → resolved.name`. **Intentional** (comment `:114-119`: `gc.formula_name` must win over title-fallback).
  6. `snapshot/collectors/runs.ts:524-546` `runFormula` — NAME: `pr_review.workflow_formula → gc.formula → title` with **extra gate** `title.startsWith('mol-')`. **Intentional** (comment `:502-523`).
  - TARGET is **byte-for-byte identical** at `formula-run.ts:213` and `routes/runs.ts:126`: `gc.run_target ?? gc.routed_to ?? assignee`.
- **Change:** One `resolveRunFormulaIdentity(root, formulaDetail?, mode)` in `formula-name.ts` returning typed `{ name, source: 'metadata'|'title_fallback'|'formula_detail'|null, target }`. **Use an explicit `mode` enum (`'lane' | 'detail' | 'route' | 'state'`), NOT boolean option flags** — the validation explicitly warns that flag combinations (`includeFormulaNameKey` + `requireTitlePrefix` + …) create untested permutations. The mode encodes each call site's *intentional* divergence (the `mol-` prefix gate, the `pr_review.workflow_formula` key, the `gc.formula_name`-wins rule). Delete `runFormula`/`runFormulaTarget` copies and the inline target resolution.
- **Tests (write first):** Lock each mode's precedence and the missing-metadata behavior as separate cases, especially: (a) `gc.formula_name` beats title-fallback in `route` mode; (b) `lane` mode rejects a non-`mol-` title that `detail` mode would accept; (c) target precedence identical across modes.
- **Risk:** Behavior-change risk if the consolidated internal order shifts — the two intentional divergences (`mol-` gate, `gc.formula_name`-wins) **must** survive. Pin them with red tests before refactoring.
- **Deps:** Pairs with WS-2 (same vocabulary edge). Prerequisite for WS-8.

#### WS-6 — Canonical run-scope / store-ref module  *(Codex D)*

- **Implementation status (2026-05-31):** Complete. `backend/src/lib/run-scope.ts` now owns request-scope validation, snapshot scope parsing, bead/feed scope parsing, and store-ref parsing while preserving the three distinct missing-scope contracts (request optional, lane unavailable, enrichment throws).
- **Why:** Scope is parsed from 5 input formats across the backend, with one true duplicate and three different missing-scope contracts.
- **Evidence:** Request query `routes/runs.ts:251-281`; bead metadata `gc.scope_kind`/`gc.scope_ref` `snapshot/collectors/runs.ts:287-344`; feed snapshot `discoverFromFeed` `:788-835`; store-ref `"kind:ref"` parsing `:348-361` (`parseRunScopeKind`, `scopeKindFromStoreRef`, `scopeRefFromStoreRef`); `GcRunSnapshot` fields `runs/enrich.ts:40-50`. **True duplicate:** `enrich.ts:126` `parseScopeKind` re-implements `collectors/runs.ts:348` `parseRunScopeKind`.
- **Change:** A typed `backend/src/lib/run-scope.ts` exposing `RunScope`/`StoreRef` types and `fromRequest`, `fromSnapshot`, `fromFeed`, `fromRootMetadata`, `fromStoreRef`. Collapse the duplicate `parseScopeKind`. Apply `SCOPE_REF_RE` consistently (today it's enforced at feed + route but **not** at bead-metadata parse).
- **Critical — preserve the 3 distinct missing-scope contracts:** HTTP query → silent `undefined` (`routes/runs.ts:280`); lane builder → structured `status:'unavailable'` (`collectors/runs.ts:341-343`); enrichment → **throws `UnsupportedRunError`** (`enrich.ts:50`). The helpers must keep these per-layer behaviors, not unify them into one.
- **Tests:** Unit-test each `fromX` and each missing-scope contract boundary; keep existing route/enrich scope-validation tests green.
- **Risk:** Conflating the three contracts would silently change error behavior. Keep return types layer-appropriate.
- **Deps:** Prerequisite for WS-8.

#### WS-7 — Consolidate run-diff reviewability policy  *(Codex H)*

- **Implementation status (2026-05-31):** Complete. `backend/src/runs/run-diff-policy.ts` owns both the git pathspec exclusions and in-memory path/classification policy; `exec.ts` and `runs/diff.ts` import it so `.beads`/`.gc` reviewability cannot drift.
- **Why:** The `.beads`/`.gc` exclusion rule exists in **two backend files in two representations** that can drift.
- **Evidence:** `backend/src/exec.ts:70-77` `RUN_REVIEWABLE_PATHS` (git pathspec syntax `:(exclude,top).beads/**`) vs `backend/src/runs/diff.ts:20` `CONTROL_PLANE_PATH_PREFIXES = ['.beads','.gc']` (string-prefix), with `isReviewableRunDiffPath` applied at **8 call sites** in `diff.ts` (`:50,52,190,193,284,346,352,381`).
- **Change:** One `backend/src/runs/run-diff-policy.ts` exposing `PATHSPECS` (the git exclude args), `isReviewablePath(path)`, and `classifyFile(path)`. `exec.ts` imports `PATHSPECS`; `diff.ts` replaces its 8 prefix checks + the classify call. Within `diff.ts`, also drop the redundant re-filter in `mergeChangedFiles:284` (paths already filtered upstream) and centralize the `a/`…`b/` path-normalization so the patch/name-status/status parsers share one extract-then-test pair (TN runs/routes #5).
- **Tests:** Property-style test asserting the git-pathspec exclusion and the string-prefix `isReviewablePath` produce **identical** results across a diverse path set (including `.beads/x`, `.gcfoo`, `src/.gc/...`). Keep `diff.ts` route coverage green; preserve "untracked non-ignored agent output stays visible, `.beads/**` + `.gc/**` always excluded."
- **Risk:** Low–medium; the two formats must stay provably equivalent — the property test is the guard.
- **Deps:** none.

---

### Tier 3 — Module decomposition (behavior-preserving relocation)

#### WS-8 — Decompose `snapshot/collectors/runs.ts` (878 LOC)  *(Codex E — include modified)*

- **Implementation status (2026-05-31):** Complete. The public `snapshot/collectors/runs.ts` file is now a thin facade over focused `snapshot/collectors/runs/` modules for constants, filtering, grouping, presentation, progress, discovery, and cache wiring. The n6f1 degraded fan-out semantics and public imports are pinned by tests.
- **Why:** A god-collector fusing transport, grouping, scope, formula identity, feed discovery, lane projection, and presentation. Four section banners already exist (`:70,91,437,593`) but 180 lines of async transport (`:698-878`) are unlabeled.
- **Change:** Split into `snapshot/collectors/runs/` modules along the validated seams:
  - `filter.ts` (pure: `runBeadFilter`), `presentation.ts` (pure: `displayTitle`, `statusCounts`, `externalReference`/`externalUrl`/`externalLabel`, `recentChanges`, `metadataString`, `compareLanes`), `progress.ts` (pure: `runProgress`, `runStagePosition`, `runStepAttempt`), `grouping.ts` (`buildRunSummary`, `runLane`, `runRootId`, `runCounts`, `runKind`), `discovery.ts` (async: `loadRunBeads`, `discoverFromFeed`, `runRigNames`, `unionRigNames`, `uniqueBeads`), `cache.ts` (`createRunsSourceCache`, `buildDefaultLoad`, the unavailable/empty placeholders), and `index.ts` as the internal module facade.
  - Keep `backend/src/snapshot/collectors/runs.ts` as the public facade that re-exports from `./runs/index.js`, or update every explicit `.js` import. Current ESM imports such as `./collectors/runs.js` do **not** resolve to `runs/index.js`.
  - **Consume the canonical modules, do not re-extract:** formula identity → WS-5's resolver; scope → WS-6's `run-scope.ts`. (This is why E is sequenced after C and D.)
- **Tests:** Reorganize collector tests to mirror modules; the pure transforms become unit-testable without IO. Public API unchanged → existing consumers compile.
- **Risk:** **Preserve the n6f1 degrade-not-collapse block verbatim** (`:734-756`, per-source try/catch + `partial` flag + `logWarn`) — do not "simplify" it into `Promise.allSettled` that hides per-source semantics. Verify no circular import (`phaseMapping` is a pure leaf; confirmed). Grep for any deep import of internal functions before moving.
- **Deps:** WS-5, WS-6.

#### WS-9 — Decompose `shared/src/index.ts` (1139 LOC) + introduce `Avail<T>` / `GcList<T>` generics  *(TN shared)*

- **Implementation status (2026-05-31):** Complete for the shared barrel split and list-generic work. `shared/src/index.ts` is now a thin 30-line package-root barrel. Runtime values Claude called out live in leaves and remain value-exported from the barrel: `operator.ts` owns `OPERATOR_DISPLAY_ALIAS`, `OPERATOR_WIRE_ALIAS`, `GC_EVENT_PREFIX`, and `errorMessage`; `context-window.ts` owns `TRUE_CONTEXT_WINDOWS` and `effectiveContextPct`. Runtime values already owned by leaves (`SCOPE_REF_RE`, `CITY_NAME_RE`, `makeNodeKey`) remain in those leaves and are re-exported by the barrel. `lists.ts` owns `Avail<T>`, `GcPartialAware`, `GcList<T>`, `GcCountedList<T>`, and `GcRequiredPartialList<T>`; simple snapshot availability states and repeated list envelopes are wired through those generics, while genuinely irregular status unions remain explicit. Domain DTOs moved to focused leaves: `transcript.ts`, `gc-agents.ts`, `gc-rigs.ts`, `gc-beads.ts`, `gc-mail.ts`, `activity.ts`, `gc-health.ts`, `gc-events.ts`, `formula-runs.ts`, `api-error.ts`, and `maintainer-triage.ts`. Remaining supervisor-wire shedding belongs to WS-10 cleanup, where generated OpenAPI response validators and upstream schema-source accuracy let the temporary dashboard-side adapters disappear.
- **Why:** A god-barrel that changes independently for beads, mail, health, triage, runs, and events (SRP violated wholesale); the type-only import cycle it already worked around (`gc-client-types.ts`) is a symptom of the barrel being load-bearing.
- **Evidence:** `shared/src/index.ts` domains: sessions/context (`:64-124`), transcript (`:136-153`), agents (`:170-226`), rigs (`:239-253`), beads (`:257-368`), mail (`:377-464`), activity (`:469-501`), health (`:505-593`), events (`:597-624`), formula/order runs (`:634-802`), maintainer triage (`:815-1121`). Two boilerplate patterns hand-copied: the `{status:'available'} | {status:'unavailable',error}` union ~9× in `snapshot/types.ts:239-480`; the `{items,total?,partial?,partial_errors?}` list envelope 8× (`index.ts:217,244,319,429,612,662`; `gc-client-types.ts:63`).
- **Change:**
  1. Carve domain leaves (`gc-beads.ts`, `gc-mail.ts`, `gc-agents.ts`, `gc-rigs.ts`, `gc-health.ts`, `gc-events.ts`, `formula-runs.ts`, `maintainer-triage.ts`, `context-window.ts` for `effectiveContextPct`+registry). Keep `index.ts` a thin barrel that preserves runtime value exports as well as type exports, or add subpath exports and update all consumers in the same PR.
     - Runtime values currently **defined in `index.ts`** need a new home before the barrel can shrink: `OPERATOR_DISPLAY_ALIAS`, `OPERATOR_WIRE_ALIAS`, `GC_EVENT_PREFIX`, `errorMessage`, `TRUE_CONTEXT_WINDOWS`, and `effectiveContextPct`.
     - Runtime values already **defined in leaf modules** should survive via re-export if the barrel keeps the relevant `export *`: `SCOPE_REF_RE` (`run-detail.ts`), `CITY_NAME_RE` (`city.ts`), and `makeNodeKey` (`links.ts`). Do not move these merely because consumers import them from the package root today.
  2. Add `type Avail<T> = { status:'available' } & T | { status:'unavailable'; error:string }` → collapses ~9 unions to one (~90 lines → ~10) and surfaces the 3 genuinely-irregular unions.
  3. Add `GcList<T>` / `GcCountedList<T> extends GcPartialAware` → collapses the 8 envelopes; model the required-vs-optional `partial` outliers as an explicit one-token override (today a silent prose divergence).
- **Tests:** `shared/src/index.test.ts` + full validation gate. Re-export surface unchanged unless the PR explicitly adds subpath exports and rewrites consumers.
- **Interaction with WS-10/WS-29 (important):** once direct-supervisor migration reaches a surface, the **raw `Gc*` wire-mirror types here are shed, not relocated** — they are replaced by generated supervisor types in the browser client, and `shared` keeps only dashboard-owned service DTOs, UI/module contracts, and any local/composed view models. So WS-9 splits a smaller surface than its 1139-line starting point implies; sequence the barrel split after the generated/direct boundary is clear.
- **Docs status:** `specs/architecture/overview.md`, `security.md`, and `extending.md` now describe the direct-supervisor target: browser-facing GC resources use generated supervisor OpenAPI directly, while `shared/` owns dashboard-local service DTOs and UI/module contracts.
- **Risk:** This is the largest mechanical change; do it as a pure relocation in one pass and lean on the compiler. Pairs with WS-2 (rename happens in the same files).
- **Deps:** After WS-2 (rename) and WS-10 G-1b (so the generated/dashboard boundary is set before carving leaves).

#### WS-10 — Replace the hand-written supervisor edge with a generated client (`@hey-api/openapi-ts`)  *(Codex F + TN supervisor — redesigned per resolved decision)*

- **Direct-supervisor disposition (2026-06-01):** Revised. Generation is still the right fix, but the generated supervisor client should be browser-consumable for GC-owned surfaces rather than permanently hidden behind a backend `GcClient` facade. Backend generation remains useful for transitional/server-only calls and for any local service code that truly must call the supervisor, but `WS-29` is the preferred cleanup path for browser-facing resources.
- **Implementation status (2026-05-31):** In progress. G-0 is complete: repo engines and CI now require Node `>=22.13.0`. G-1a is complete: `backend/openapi-ts.config.ts` generates a committed hey-api SDK/type/client/Zod folder under `backend/src/generated/gc-supervisor-client`, and `openapi:gc-supervisor:check` regenerates into a temp dir and byte-compares that generated tree. G-1b transport cutover is complete: `GcClient` now calls the generated SDK and `@hey-api/client-fetch` runtime, and the old `openapi-typescript` artifacts, `openapi-fetch` dependency, custom schema-map extractor, AJV overlay, and generated schema validator have been deleted. G-1c is complete: generated files no longer carry `// @ts-nocheck`, are no longer excluded from backend TypeScript, are no longer ignored by ESLint, and `npm run typecheck` / `npm run lint` fail on generated-client issues (`lint` already uses `--max-warnings=0`). The generator wrapper does not post-process generated output; `@hey-api/client-fetch` is configured with `bundle: false` so the generated tree imports the runtime package instead of copying patchable runtime files into `src/generated`. Because the published `@hey-api/client-fetch` package types lag the current `@hey-api/openapi-ts` generator, `backend/src/types/hey-api-client-fetch-compat.d.ts` is an ambient type-only compatibility shim pinned by tests; it is not wired through `tsconfig.paths`, so runtime imports still resolve to the real npm package. The runtime HTTP path is tested to execute generated response validators. G-3 response validation is now enabled with the hey-api SDK `validator: { response: 'zod' }` option and the generated `zod.gen.ts` file; malformed supervisor payloads are rejected before DTO mapping. Concrete write-edge casts are being removed as found; `sendMail` now decodes its created-message response instead of casting. Remaining WS-10 gaps are explicit: `gc-supervisor-decoders.ts` remains a temporary hand-Zod DTO adapter/normalizer on top of generated response validation, some raw supervisor mirror shapes still live in `shared` until WS-29 deletes or moves them to generated browser supervisor types, and upstream GC supervisor API gaps are consolidated in [`../gc-supervisor-api-gaps.md`](../gc-supervisor-api-gaps.md).

**Decision (grill + gascity reference + no-backcompat directive):** Don't tidy the hand-rolled edge — **replace it.** Generate the supervisor client + types (+ SSE-capable SDK surface) from `backend/openapi/gc-supervisor.openapi.json` with `@hey-api/openapi-ts`, exactly as the upstream `gascity` dashboard does (`~/code/gastownhall/gascity/cmd/gc/dashboard/web/openapi-ts.config.ts`: plugins `@hey-api/client-fetch`, `@hey-api/typescript`, `@hey-api/sdk`, generating the whole `client.gen.ts`/`sdk.gen.ts`/`types.gen.ts`/SSE surface with **zero** hand-written client). Unlike gascity (which validates **nothing** at runtime), also enable the **Zod plugin** so the same spec generates runtime response validators — honoring this repo's spec invariant *"runtime deserialization at GcClient rejects malformed payloads"* (Ideal #2, L691). The target is a **100% generated supervisor API client**, with only non-API dashboard policy and DTO mapping hand-written.

- **Why:** `gc-client.ts` (866) and `gc-supervisor-decoders.ts` (879) are ~1.7k hand-written lines reimplementing what the generator produces — path/param construction, request/response types, and per-resource validation — plus three overlapping representations (generated OpenAPI/AJV + hand-Zod + the `SchemaOutputFor` type-machine) and a write edge that casts unknown via `writeJson<T>` (`:261-282`).
- **Prerequisite:** Current `@hey-api/openapi-ts` releases require Node `>=22.13.0`. G-1 uses Node `>=22.13.0`; do not retain a Node-20 fallback path.
- **Generated code is browser-eligible.** The generator inputs are the supervisor OpenAPI document plus hey-api config; generation wrappers stay regenerate/check tools, not second schema generators. No generated-output post-processing is allowed: if generated code fails strict type/lint gates, fix the OpenAPI schema, generator configuration, or upstream tool dependency rather than patching generated files.
- **`GcClient` becomes transitional.** Where it remains, it is a thin policy facade over the generated SDK. For browser-facing GC resources, prefer deleting the facade path entirely and calling the generated supervisor client from frontend hooks. Any remaining backend facade must not own API path construction, operation lookup, wire response typing, generated-schema extraction, or durable DTO mapping.
- **Delete by phase, not by wishful thinking:** G-1b deletes `backend/src/generated/gc-supervisor.ts` (old `openapi-typescript` output), `backend/src/generated/gc-supervisor-schemas.ts` (custom extracted schema map), `gc-supervisor-schema-validator.ts` (AJV overlay), `openapi-fetch`, and the custom schema-extraction half of `scripts/generate-gc-supervisor-client.mjs`. `GcClient` must not keep a parallel hand-written supervisor client. The only acceptable temporary adapter is `gc-supervisor-decoders.ts` as a narrow dashboard DTO mapper with generated hey-api input types and a named cleanup condition. Generated Zod response validation is now safe and enabled; the remaining deletion work is to replace hand-Zod schemas/`SchemaOutputFor` with generated browser supervisor types or local view-model mapping, then delete residual raw supervisor mirrors from `shared`.
- **Accuracy fixes are upstream GC supervisor API gaps.** The schema and presentation/data gaps that must be fixed in `gastownhall/gascity` are consolidated in [`../gc-supervisor-api-gaps.md`](../gc-supervisor-api-gaps.md). This repo re-pulls upstream schema changes via `npm run openapi:gc-supervisor:update`; do not patch generated output or use dashboard-side schema overlays as the permanent fix.
- **Phased rollout (forced by the accuracy dependency):**
  - **G-0 (toolchain):** Move CI/local runtime to Node `>=22.13.0`. This is not optional for current `@hey-api/openapi-ts`.
  - **G-1a (generation):** Add `@hey-api/openapi-ts`; generate client+types+SDK from `backend/openapi/gc-supervisor.openapi.json`; make `openapi:gc-supervisor:check` compare the generated tree.
  - **G-1b (hard cutover, no compatibility aliases):** Re-point `GcClient` internals at the generated SDK (transport + types). Delete the hand request/path/operation plumbing, `openapi-fetch` client code, old generated `openapi-typescript` artifacts, and custom schema extractor. Translate `workflow_id → run_id` in a thin dashboard DTO adapter; do not expose old dashboard aliases.
  - **G-1c (generated strictness):** Complete. Remove the `// @ts-nocheck` post-generation rewrite and make generated artifacts part of the normal `tsc` + ESLint gates. The generated tree imports `@hey-api/client-fetch` with `bundle: false`, so the dashboard does not copy or patch hey-api runtime internals. A single ambient type-only runtime compatibility shim covers the current npm package/generator version skew and is pinned by tests; any future generated strictness failure is treated as an OpenAPI/config/tooling bug to fix at the source.
  - **G-2 (upstream):** Land the OpenAPI accuracy fixes and related supervisor API gaps listed in [`../gc-supervisor-api-gaps.md`](../gc-supervisor-api-gaps.md); refresh the committed spec here; add fixtures for the previously-degraded shapes. The dashboard's committed OpenAPI already carries the nullable `Bead.priority` correction needed by the current generated validators, but the upstream GC supervisor Huma/OpenAPI source must be fixed before this dashboard relies on future `openapi:gc-supervisor:update` refreshes.
  - **G-3 (strict generated validation):** Complete for runtime response validation. Generated-**Zod response validation** is enabled at the `GcClient` edge; malformed payloads now fail before DTO mapping per the spec invariant. The remaining G-3 cleanup is to delete any temporary hand-Zod schemas/normalizers that only existed to bridge schema drift. This subsumes the WS-13 `getStatus`/`decodeSling` all-optional fixes (the generated validators + accurate required fields replace those hand schemas). The only surviving hand code at this boundary should be dashboard policy and explicit DTO mapping the generator cannot express.
- **hey-api features to leverage (verified against current docs, May 2026 — maximize generated code per the directive):**
  - **SDK `validator` option** — `validator: { response: 'zod' }` wires the generated Zod schemas into every SDK call (async `parseAsync`), so **OpenAPI-shape runtime response validation is generated, not hand-written**. This is now enabled. Current hey-api fetch-client output validates but discards the parsed/coerced return value, so dashboard DTO normalization still belongs in explicit mapping code for now. The follow-up cleanup should shrink `gc-supervisor-decoders.ts` from a hand-Zod validator module into explicit DTO mapping only, then delete it if the mapping becomes small enough to live with the facade methods. Use response-only validation (we build request shapes; the supervisor's responses are what need guarding).
  - **Zod v4 plugin** — generates Zod 4 schemas by default; backend is already on `zod ^4.4.3`, so no version bump.
  - **Transformers plugin (built into `@hey-api/openapi-ts`, not a separate npm package)** — generates response transformers (e.g. ISO date-time → `Date`, big-int handling) so any hand date/number coercion at the edge disappears. Implementation note: there is no published `@hey-api/transformers` package in npm as of this pass; configure it as a plugin name through the generator if/when we adopt it, not as an install dependency.
  - **client-fetch interceptors + `createClientConfig()`** — `client.interceptors.{request,response,error}.use(...)` is where facade policy lives: **topology-safe error redaction** (response/error interceptor), `Origin`/auth headers, and logging — instead of hand-wrapping each call. `runtimeConfigPath`'s `createClientConfig()` centralizes `baseUrl` (the city URL), a custom `fetch` (timeout + output-cap + 127.0.0.1), and `throwOnError`.
  - **What must stay hand-written (interceptors can't express it):** single-flight URL-keyed **coalescing** (a dedupe layer above the SDK) and the **`workflow_id → run_id` rename** (a field remap, not a type transform). These two are the irreducible core of the `GcClient` facade.
  - **Prerequisite (verified):** hey-api is **ESM-only as of 2026** and requires Node `>=22.13.0`; backend is already `"type": "module"` + `moduleResolution: bundler`. The migration has removed `ajv`, superseded `openapi-typescript`, and removed `openapi-fetch`.
  - **Out of scope (noted, not silently dropped):** hey-api's TanStack Query plugin would cut the *frontend's* per-route fetch/poll boilerplate — but only if the dashboard's own `/api/*` had an OpenAPI to generate from, which it doesn't today. Authoring a dashboard-side OpenAPI to unlock that is a separate, larger initiative, not part of WS-10.
- **Tests:** Retire `gc-supervisor-decoders-types.test.ts` when `SchemaOutputFor` dies; generated-Zod validation is now covered by `backend/test/gc-supervisor-generation-config.test.ts` and malformed-payload `GcClient` tests. **Keep `GcClient`'s coalescing / redaction / `workflow_id→run_id` tests green — those behaviors must survive the rewrite.** Generator coverage now verifies the old `openapi-typescript` pipeline is gone, `openapi:gc-supervisor:check` verifies the `@hey-api` generated tree, generated code has no `@ts-nocheck`, generated Zod response validators are wired into the SDK, and generated code is covered by backend typecheck + ESLint.
- **Risk (do-not-break invariants):** single-flight coalescing, topology-safe **redaction**, timeouts/output-cap, and the `workflow_id → run_id` edge normalization must all survive in the thin facade. **SSE:** this repo proxies supervisor SSE same-origin (`routes/sse-proxy.ts`) for CSP — that's a security boundary, not just transport; **default: keep the proxy**, don't replace it with the generated browser SSE handlers. The main remaining risk is ownership drift: do not let `gc-supervisor-decoders.ts` become a second schema authority now that generated response validation is active. **Spec status:** `specs/architecture/formula-run-detail-type.md`, `AGENTS.md`, and `specs/architecture/overview.md` now describe the generated client + runtime-validation boundary and the remaining DTO-adapter cleanup.
- **Deps:** G-2 upstream source sync still depends on gascity work. Coordinate the `workflow_id → run_id` normalization with WS-2. Unblocks WS-9's shedding of the raw `Gc*` wire mirrors.

#### WS-11 — Decompose the maintainer modules + reuse canonical helpers  *(TN maintainer)*

- **Implementation status (2026-05-31):** Complete. The `/sling` request-body validation gauntlet is now a pure `sling-request.ts` decoder with focused unit coverage, serve-time slung overlay lives in `serve-overlay.ts`, and sling dispatch/audit/slung-state persistence/target-resolution/refresh-notification lives in `sling-dispatch.ts`, leaving the Express route to own HTTP decode/response/error mapping. The `/refresh` ExecError path now uses centralized `writeExecError(..., { fallbackStatus: 502 })`; `findContributor` and `countItems` reuse `collectItems`; `triage.ts` imports the shared `parseJsonArray` helper instead of carrying a duplicate parser; and `issueNumbersWithInFlightPr` is now the shared in-flight PR predicate consumed by both `computeHasInFlightPr` and `selectOneMark`. On the frontend, the pure tier transforms now live in `triageFilters.ts`, their tests import that module directly instead of reaching through `Maintainer.tsx`, maintainer collapse state now uses the shared `usePersistedCollapseSet` hook with focused persistence/parse-failure tests, `SelectionActionBar`/`MaintainerFooter` now live in `MaintainerChrome.tsx`, and `CollapsibleHeader`/`CollapseGlyph` are shared by maintainer sections and generic project-group headers.
- **Why:** `backend/.../maintainer/router.ts` (589) fuses the HTTP edge with the serve-time overlay engine and re-implements three helpers that already exist canonically; `frontend/.../Maintainer.tsx` (682) hoards pure transforms, a storage hook, and sub-views.
- **Evidence (backend):** `router.ts:182-196` re-inlines the ExecError→HTTP map that `lib/sanitise-error.ts:50-69 writeExecError` owns (used canonically in `routes/beads.ts:263`, `agents.ts:187`, `git.ts:52`); `triage.ts:154-168 parseJsonArray` duplicates `lib/parse-json.ts:4-18` (its sibling `contributor.ts:11` already imports the lib version); `router.ts:428-435,463-474` (`findContributor`, `countItems`) re-walk the envelope by hand instead of the exported `triage.ts:289-298 collectItems`; the in-flight-PR set is rebuilt at `triage.ts:327` and `:384`; the `/sling` handler is a 60-line inline validation gauntlet (`router.ts:215-276`).
- **Evidence (frontend, baseline review):** `Maintainer.tsx` held pure tier transforms (`:68,92,121`), local `useCollapseState` storage logic (`:140-180`), `SelectionActionBar` (`:508-609`), `Footer`/`buildSynopsis`; `TriageSections.tsx` + `ProjectGroupHeader.tsx` ship 3+ incompatible collapsible-header implementations with two glyph conventions.
- **Change (backend):** Complete. The inline ExecError map uses `writeExecError(..., { fallbackStatus: 502 })`; duplicate `parseJsonArray` is gone; `findContributor`/`countItems` route through `collectItems`; `issueNumbersWithInFlightPr(items)` is shared by both call sites; `decodeSlingRequest(body)` lives in pure `sling-request.ts`; `applySlungOverlay(envelope, path)` lives in `serve-overlay.ts`; and `dispatchMaintainerSling(body, deps)` owns supervisor write dispatch, audit rows, active slung-state writes, target-session resolution, and maintainer SSE refresh notification.
- **Change (frontend):** Complete. Pure tier transforms moved to `triageFilters.ts`; collapse persistence moved to `hooks/usePersistedCollapseSet`; `SelectionActionBar`/`MaintainerFooter` moved to `MaintainerChrome.tsx`; and `CollapsibleHeader`/`CollapseGlyph` now unify maintainer section and project-group collapse controls. Folds in WS-3's format reuse.
- **Tests:** `maintainer-has-in-flight-pr.test.ts` pins the shared in-flight PR predicate; `maintainer-select-one-mark.test.ts` proves the One Mark behavior still consumes it correctly; `serve-overlay.test.ts` pins the active-slung lift, stale-vetted override, run-link stamping, and empty-cluster drop; `sling-dispatch.test.ts` pins success/failure audit, slung-state persistence, target resolution, and refresh notification. `Maintainer.needs-pr.test.tsx` / `Maintainer.needs-triage.test.tsx` import real filter modules, `usePersistedCollapseSet.test.tsx` pins persistence plus parse-failure reporting, `Maintainer.test.tsx` imports the chrome components directly, and `CollapsibleHeader.test.tsx` pins the shared collapse header contract.
- **Risk:** The One-Mark invariant is split across compose-time (`triage.ts`) and serve-time (`serve-overlay.ts`), with direct tests on both halves. Behavior-preserving.
- **Deps:** WS-3 (format helpers). Independent of backend Tier 2.

#### WS-14 — `groups.ts` single-pass identity model; remove in-place `delete` mutation  *(TN runs/routes)*

- **Implementation status (2026-05-31):** Complete. `groupRunBeads` now resolves a single `BeadIdentity` per bead, buckets visible beads by semantic node id, then builds each `RunNodeGroup` from the complete bucket. Group shape selection is deterministic by construct priority and stable bead keys, optional fields are emitted with conditional object spreads rather than delete-based mutation, and badge aliases reuse the computed identity map instead of recomputing grouping identity. Tests pin order-independent group shape and guard against reintroducing `delete group[...]`.
- **Why:** `backend/src/runs/groups.ts` has five overlapping notions of bead identity computed redundantly, plus order-dependent in-place mutation — the area `relation-index.ts:7-14` flags as "the single biggest premortem failure mode."
- **Evidence:** `groups.ts:126-157` `resolveSemanticIds` computes `duplicateResolutionIdentity` twice per bead; `visibleNodeAliases:235` recomputes `groupingBaseSemanticId`; `assignOptional:106-116` does `delete group[key]` to "unset" optional fields mid-iteration (`:71-79`).
- **Change:** Compute one `BeadIdentity { base, disambiguator, aliases }` per bead, memoized in a `Map`. Group by `base`; disambiguate only when a base has >1 distinct disambiguator. Build each `RunNodeGroup` once by reducing its full bead list (two-pass: bucket → reduce) — no in-place promotion, no `delete`, no iteration-order dependence.
- **Tests:** Existing `run-groups.test.ts` golden fixtures must stay green; add a test asserting group shape is independent of bead order.
- **Risk:** Medium — this is dense, well-tested logic. Lean on the golden fixtures.
- **Deps:** none.

---

### Tier 4 — Boundary correctness (surfaces previously-hidden failures)

#### WS-12 — Split run detail/diff into independent resources; honest diff errors; decouple tab from node-selection  *(Codex G + TN hooks — resolved: both moves accepted)*

**Decision (grill):** Both Codex moves confirmed — **split the hooks** and **decouple the tab**, overriding the spec's single-hook/auto-switch model. The spec must be amended to match (see Risk).

- **Implementation status (2026-05-31):** Complete. `useFormulaRunDetail` now loads only the run projection, `useRunDiff` is an independent cached resource with its own `idle|loading|ready|failed` state, and the page refresh/event path refreshes both resources without collapsing diff failures into detail failures. `FormulaRunTabs` no longer watches selected-node changes; Session content appears only when the user selects the Session tab, so selecting graph nodes cannot override an explicit Diff choice. Focused hook/component/page tests pin the split resource behavior, real diff failure state, and tab persistence across node selection.
- **Why:** Detail and diff are independently refreshable/failable, but the hook fetches them as one `Promise.all` and **fabricates a fake success** when the diff fails; and node-selection forcibly overrides the user's tab choice.
- **Evidence:** `useFormulaRunDetail.ts:79-96` — `Promise.all([detail, diff])`; the `api.runDiff` catch (`:81-93`) returns a hand-built `{kind:'error', ...} satisfies RunDiffResponse` and the outer state still resolves `ready` (`:95`). `FormulaRunTabs.tsx:16-18` — a `useEffect` forces `tab='session'` whenever `selectedNodeId` changes; `FormulaRunDetail.test.tsx:164-169` locks this in. `RunNodeEvidencePanel.tsx:22` renders the Diff tab from `diff` alone (node-independent), so the diff is run-level/execution-folder evidence (spec invariant L721).
- **Change:**
  1. **Split** into `useFormulaRunDetail` (detail resource) and `useRunDiff` (diff resource), each its own `useCachedData` key and explicit `idle|loading|ready|failed` union; `FormulaRunDetailPage` composes both → a failed `api.runDiff` surfaces a real `failed` state instead of a fabricated `RunDiffResponse`.
  2. **Decouple** the tab: remove the `FormulaRunTabs.tsx:16-18` effect so tab state responds only to user clicks / initialization. Selecting a node no longer auto-switches to Session.
- **Tests:** **Rewrite** `FormulaRunDetail.test.tsx:164-169` to assert the tab **persists** across node-selection (was: asserts auto-switch to Session). The focused browser harness **`scripts/snap-formula-run-detail.mjs`** clicks Session *before* selecting a node, so it survives — but verify. Add a test asserting a failed `api.runDiff` yields `useRunDiff → failed`, not a silent empty diff.
- **Risk:** This is the **one run-detail interaction behavior change** in the plan: clicking a node no longer jumps to Session, and because the diff is node-independent, a node-click while on Diff now changes only the node's pressed state, not the right panel. Consumers that checked `diff.kind !== 'error'` now get an explicit `failed` state — audit them. **Spec status:** `specs/architecture/formula-run-detail-type.md` (UI Consumption + Invariants) has been amended to the two-resource + tab-as-user-state model; implement to match. The focused harness defaults to `http://127.0.0.1:5174` and can target another dev stack with `SNAP_BASE`.
- **Deps:** none.

#### WS-13 — Close the remaining swallowed-error gaps  *(TN maintainer / supervisor / hooks)*

- **Implementation status (2026-05-31):** Complete for the independent WS-13 items. `buildSlingRequests` now returns `{ requests, skippedKeys }` instead of silently dropping selected-but-vanished items, `MaintainerPage` preserves the skipped count after dispatch, and `SelectionActionBar` surfaces "`M` skipped; no longer in list" while disabling send when nothing sendable remains. The frontend `/api/*` client now threads every `api.*` method through an explicit response decoder at the single `request()` chokepoint; malformed 200 JSON is rejected with `ApiResponseDecodeError` instead of cast to the expected DTO. The supervisor `getStatus`/`decodeSling` all-optional issue is intentionally folded into WS-10 G-2/G-3 generated-Zod validation.
- **Why:** "Don't swallow errors" is an explicit project rule, violated where it's least visible.
- **Evidence + Change:**
  - `maintainerSelection.ts:64` `buildSlingRequests` silently `continue`s past selected-but-vanished items → the success line "Slung N" can be fewer than selected. **Complete:** return dropped keys; surface "M skipped" in the action bar (`Maintainer.tsx:549`).
  - `gc-supervisor-decoders.ts:419` `getStatus` and `:739` `decodeSling` are all-optional schemas → a broken-shape response decodes to `{}` indistinguishable from benign degradation. **Now subsumed by WS-10:** the generated-Zod validators (G-3) plus the upstream accuracy fixes (G-2, making the identity fields `required`) replace these hand schemas, so a wrong shape fails at the edge. No separate `.refine()` work — fix it where the schema is generated.
  - `api/client.ts:65` `request<T>` does `(await res.json()) as T` for ~25 methods while the SSE hooks validate every field. This is the **frontend `/api/*` edge** (dashboard DTOs), separate from the supervisor edge WS-10 covers. **Complete:** every `api.*` method passes a per-endpoint decoder to `request()`, and `performRequest()` rejects malformed JSON or missing top-level DTO fields instead of trusting an unchecked cast.
- **Tests:** `maintainerSelection.test.ts` and `Maintainer.test.tsx` cover the "M skipped" path. `api/client.test.ts` covers malformed successful JSON at the frontend `/api/*` edge. Generated-Zod supervisor validation tests belong under WS-10 G-3.
- **Risk:** These intentionally turn silent degradations into visible errors — confirm each surfaced error has a sensible UI path.
- **Deps:** `getStatus`/`decodeSling` now fold into WS-10 G-2/G-3. The `buildSlingRequests` and `api/client.ts` items are independent.

---

### Tier 5 — 2026-06-01 reopened paydown from full-codebase review

These are current, validated against `main` after the earlier completed workstreams. Use red-green TDD for each code change: write or adjust the failing test first, observe the failure when practical, implement the smallest behavior-preserving structural fix, then run the focused suite before moving on.

#### WS-15 — Collapse `GcClient` read/write templates into operation descriptors  *(Claude P1 #1 + TN backend)*

- **Direct-supervisor disposition (2026-06-01):** Superseded for browser-facing GC surfaces by `WS-29`. Keep this workstream only as a fallback for server-only or transitional supervisor calls that remain after the migration. Do not invest in a large `GcClient` diet if the same code can be deleted by moving the surface to the generated browser supervisor client.
- **Implementation status (2026-06-01):** In progress. The descriptor-table slice is complete: read endpoints now use explicit `READ_OPERATIONS` metadata for operation name, payload name, and decoder handoff; `decoderPayloadName()` is gone; pass-through `writeOperation()` / `mutationHeaders()` wrappers are gone; and a structure test pins those guardrails. The second helper slice is also complete: plain city-scoped reads now share `cityReadOptions()` instead of repeating generated-SDK client/path/signal wiring. The class still needs a deeper diet because query assembly and path-param call construction remain inline per endpoint.
- **Why:** The class still repeats the same generated-SDK call shape, query object shape, operation key shape, decoder handoff, and timeout/signal plumbing per endpoint. That duplication is now the main reason `GcClient` stayed above the 1k-line thermonuclear threshold after WS-10.
- **Evidence:** `backend/src/gc-client.ts:102` starts the class; `:154-187` is the generic single-flight read core; individual reads repeat the template at `:364-375`, `:407-418`, `:473-484`, `:520-573`, `:604-618`, `:620-645`, `:655-706`, and `:859-875`. `writeOperation` is a pass-through at `:273-279`; `mutationHeaders()` and `cityPathParams()` are constant-return helper wrappers at `:256-283`; `decoderPayloadName()` reverse-scans decoder identity at `:925-930` even though every call site already knows its payload name.
- **Change:** Introduce typed `readOperation(name, decoder, sdkCall, params, opts)` / descriptor helpers that derive the cache key from the exact path/query object sent upstream. Inline or delete `writeOperation`, `mutationHeaders()`, and any identity reverse-scan; pass the payload name explicitly. Keep the irreducible facade responsibilities: single-flight coalescing, timeout/output-cap behavior, topology-safe error redaction, response datetime normalization, and dashboard DTO mapping.
- **Tests:** Add focused `gc-client` tests that prove two calls with identical query/path params coalesce and two calls with different params do not, especially `listBeads` and `getRun` scope params. Keep existing malformed-payload, redaction, timeout, and generated-validation tests green.
- **Risk:** Medium. The generated SDK calls are behavior-critical and heavily tested; keep the refactor incremental and let existing `backend/test/gc-client.test.ts` be the safety net.
- **Deps:** Builds on WS-10 G-1b/G-3; should happen before deleting the temporary decoder adapter because it simplifies that later deletion.

#### WS-16 — Finish dashboard `/api/*` runtime DTO schemas instead of shallow client casts  *(TN boundary + Claude P3 #6)*

- **Direct-supervisor disposition (2026-06-01):** Revised scope. Do not add shared runtime schemas for GC-owned mirror lists that should disappear behind the generated supervisor client. Keep shared schemas for dashboard-owned local/composed DTOs, especially `git`, `gh`, host health, client-error telemetry, and any Formula Run Detail view model that remains dashboard-owned until the supervisor exposes a canonical presentation shape.
- **Implementation status (2026-06-01):** Complete for the validated high-risk dashboard DTO surfaces. `shared/src/dto-schemas.ts` exports `MaintainerTriageSchema`, `FormulaRunDetailSchema`, `RunDiffResponseSchema`, and shared schemas for the common session/agent/bead/mail list DTOs. The frontend API client uses those schemas for `/maintainer/triage`, `/maintainer/refresh`, `/runs/:runId`, `/runs/:runId/diff`, `/sessions`, `/agents`, `/beads`, `/mail`, and `/mail/threads/:id`; backend maintainer cache reads validate the nested triage envelope through the shared schema. Shared, backend, and frontend tests pin nested malformed DTO rejection. Lower-risk endpoints with simple top-level local decoders remain local until a concrete drift or nesting risk justifies promoting them.
- **Why:** `shared` is supposed to make DTO mismatches fail at compile time, but runtime browser edges still accept nested malformed JSON for complex contracts. The current decoders are better than a raw `json() as T`, but they are not a real schema authority.
- **Evidence:** `frontend/src/api/client.ts:235` returns `record as T`; list decoders check only that `items` is an array at `:246`; complex responses such as formula run detail are shallow at `:338-348` while `shared/src/run-detail.ts:157` declares deeply required `nodes`, `edges`, `lanes`, `progress`, and `completeness` contracts. Maintainer cache reads similarly cast after a partial key check at `backend/src/views/modules/maintainer/storage.ts:42` and `:98`.
- **Change:** Move reusable dashboard DTO runtime schemas/decoders into `shared` for the highest-risk contracts first (`FormulaRunDetail`, list envelopes, `MaintainerTriage`). Make `frontend/src/api/client.ts` and maintainer cache storage call those schemas rather than local shallow guards. Keep `shared` free of React/Express.
- **Tests:** Red tests should feed malformed nested DTOs through `api/client.test.ts` and maintainer cache tests and assert decode failures, not silently accepted objects.
- **Risk:** Medium. This intentionally turns malformed local API payloads into visible errors; UI surfaces should already handle `ApiResponseDecodeError`.
- **Deps:** Coordinates with WS-10 cleanup so `shared` schemas describe dashboard DTOs, not raw supervisor wire shapes.

#### WS-17 — Strip public supervisor DTOs and preserve partial-list metadata  *(TN backend + TN boundary)*

- **Direct-supervisor disposition (2026-06-01):** Transitional only. Preserving partial metadata and stripping host-only fields is necessary while `/api/*` mirror routes exist, but the final fix is to delete those mirror routes and consume supervisor partial/degraded fields directly from generated types. Do not treat public supervisor DTO stripping as permanent architecture.
- **Implementation status (2026-06-01):** Complete. `/api/sessions`, `/api/beads`, and `/api/mail` now preserve `partial` / `partial_errors` from decoded supervisor lists, `partialWireFields()` centralizes the route projection, and focused route tests pin the behavior. Frontend API return types/decoders were widened to keep those fields available. `listItemsField()` now accepts required `items: T[] | null` and no longer hand-normalizes missing `items` to `[]`; generated validation already rejected the missing-field case, and a `GcClient` regression test pins it. Public supervisor-derived schemas now strip unknown runtime keys instead of relying on TypeScript-only hiding; tests cover sessions, rigs, agents, beads, mail, events, health, and city envelopes. The host-only city registry path remains explicit through `listSupervisorCities()`, which retains `path` while stripping unknown extras.
- **Why:** Browser-facing supervisor-derived shapes still allow unknown wire keys through in several schemas, and list routes drop partial/degraded metadata after decoding it. That violates both the security posture ("host-only data stays host-side") and the degraded-data UI contract.
- **Evidence:** Previously `.passthrough()` on public decoders let unknown supervisor keys survive to route serialization in `routes/agents.ts`, `routes/beads.ts`, and `routes/mail.ts`; `listItemsField()` also accepted `undefined` and routes narrowed away `partial` / `partial_errors`.
- **Change:** Make browser-facing schemas strip by default; create explicit host-only raw schemas for the few call sites that intentionally need extra fields. Replace `listItemsField()` with a required-nullable helper for required list envelopes. Add a route projection helper that filters items while preserving sanitized `partial` / `partial_errors`.
- **Tests:** Add malformed-list tests proving missing required list fields reject while `items: null` still maps to `[]`; add route tests proving partial metadata survives filtering.
- **Risk:** Medium. Unknown supervisor keys may currently be visible in ad-hoc debug paths; removing them is intentional.
- **Deps:** Coordinates with WS-16 and WS-10 cleanup.

#### WS-18 — Split bead close from agent nudge  *(TN backend behavior bug)*

- **Archived status (2026-06-01):** Superseded by the direct-supervisor
  migration plan. Bead close moved out of the dashboard service after `GC-10`;
  nudge remains temporary dashboard-service migration debt until `GC-11` adds a
  supervisor HTTP endpoint. The historical "split the combined exec helper"
  guidance below remains useful only as context for why nudge must not overload
  bead ids as agent aliases.
- **Why:** The API path says "nudge this bead", the backend route validates a bead ID, and the exec layer then treats the same value as an agent alias. That is both a behavior bug and a bad abstraction: two different command domains are forced through one function.
- **Evidence:** Frontend posts `api.nudgeBead(bead.id)` at `frontend/src/api/client.ts:452` and `frontend/src/routes/Beads.tsx:117`; the route validates the path param as a bead ID at `backend/src/routes/beads.ts:230`; `execBeadAction(beadId, 'nudge')` then validates that same value as an agent alias at `backend/src/exec.ts:118`.
- **Change:** Replace `execBeadAction(beadId, action)` with `execCloseBead(beadId, reason, deps)` and `execNudgeAgent(alias, deps)`. The nudge endpoint should pass an explicit assignee/alias in the body or route to a clearly named agent endpoint; do not overload bead IDs as aliases.
- **Tests:** First update/add a backend route test that a bead nudge command uses the bead's assignee alias rather than the bead ID, and a frontend test that the action posts the chosen alias. Existing bead-close tests should continue to use bead IDs.
- **Risk:** Medium-high because this intentionally changes currently pinned tests that encode the wrong abstraction.
- **Deps:** None.

#### WS-19 — Make mail filtering honest and single-fetch  *(TN backend)*

- **Implementation status (2026-06-01):** Complete. `GcClient.listMail` now exposes only the upstream-supported `limit` parameter, and the thread route fetches one wide mail list before applying local inbox/sent alias filtering and thread filtering. A route regression test proves `/api/mail/threads/:id` makes one supervisor `/mail` call.
- **Why:** `GcClient.listMail()` accepts filters that the supervisor ignores, keys its inflight cache by those no-op filters, and callers perform duplicate upstream reads for inbox and sent views. The code comments admit the mismatch; the abstraction should match reality.
- **Evidence:** `GcClient.listMail()` accepts `{ box, alias, limit }` at `backend/src/gc-client.ts:575`, sends only `limit` at `:585-587`, but keys by `box` and `alias` at `:587-592`. The thread route performs two upstream calls at `backend/src/routes/mail.ts:113-114` and filters locally afterward.
- **Change:** Make `listMail()` accept only upstream-supported params today (`limit`) and expose a local `filterMailByBox(items, box, alias)` route helper. Fetch once for combined thread views, then filter locally into inbox/sent buckets.
- **Tests:** Red route test proving the thread endpoint makes one upstream mail call for a combined inbox/sent request; `GcClient` tests should prove `box`/`alias` no longer affect the upstream key until the supervisor actually supports them.
- **Risk:** Low-medium; behavior should be preserved while removing duplicate upstream traffic.
- **Deps:** None.

#### WS-20 — Typecheck and glob-discover shared tests  *(Claude config #1)*

- **Implementation status (2026-06-01):** Complete. `shared/tsconfig.test.json` now typechecks shared test files, root `typecheck:test` includes the shared workspace before backend/frontend, and the shared test script glob-discovers every `src/**/*.test.ts` file instead of hardcoding two entries.
- **Why:** Shared tests are part of the shared DTO contract but the root typecheck gate skips them, and the test script only names two files. New shared tests can be silently unrun or untypechecked.
- **Evidence:** `shared/tsconfig.json:25-26` includes `src` but excludes `src/**/*.test.ts`; root `package.json:25` runs backend/frontend test typechecks only; `shared/package.json:17` hardcodes `src/index.test.ts src/session-resolve.test.ts`.
- **Change:** Add `shared/tsconfig.test.json`; add `shared` to root `typecheck:test`; change the shared test script to glob all `src/**/*.test.ts`.
- **Tests:** Run `npm --workspace shared run typecheck:test`, `npm --workspace shared test`, and root `npm run typecheck:test`.
- **Risk:** Low. This can surface stale test-only type errors, which is the point.
- **Deps:** None. Do before adding new shared decoder/schema tests for WS-16.

#### WS-21 — Clean build output before compiling  *(Claude config #2)*

- **Implementation status (2026-06-01):** Complete. A repo-root `scripts/clean-dist.mjs` removes workspace `dist` directories, each workspace build runs its own clean step before compiling, and root `npm run clean` removes all workspace build outputs. The backend orphan-file red check now passes: a stale file under `backend/dist` disappears before `npm run build:backend` compiles.
- **Why:** `tsc` does not remove orphaned output. Ignored `dist` directories can keep deleted generated modules around locally and make manual runtime checks lie.
- **Evidence:** Root `build` chains workspace builds without cleaning at `package.json:12`; backend build is plain `tsc` at `backend/package.json:9`.
- **Change:** Add workspace/root `clean` scripts that remove `backend/dist`, `shared/dist`, and `frontend/dist`, and run them before build. Prefer Node's built-in `fs.rm` via a small script or direct `node -e` so the command remains portable enough for CI.
- **Tests:** Red check should create an orphan file under a `dist` directory, run the relevant build, and assert it disappears. At minimum, add/adjust a package-script test if the repo already has script tests; otherwise verify with a manual command in the implementation note and keep the script simple.
- **Risk:** Low. Be careful not to delete generated source under `backend/src/generated`.
- **Deps:** None.

#### WS-22 — Remove small mutation/dead-scaffold hazards while nearby  *(TN frontend + Claude P5)*

- **Implementation status (2026-06-01):** Complete. `RunNodeSessionPanel` now sorts a copy of `executionInstances` and has a focused regression test proving render does not mutate the DTO array. `selectOneMark` keeps the tested behavior but drops the long removed-history commentary. `module.resources` remains a required descriptor contract, but it is no longer passive scaffolding: `bind()` validates resource declarations at runtime and focused tests reject malformed or duplicate resource entries from JS interop.
- **Why:** These are small code-quality hazards that do not justify architecture on their own, but they are cheap deletion when touched by adjacent work.
- **Evidence:** `RunNodeSessionPanel.tsx:22` sorts `node.executionInstances` in place during render. `triage.ts:394-473` carries long parent-transfer/comment archaeology around `selectOneMark`. `shared/src/views.ts:137-138` requires `module.resources`, but no active consumer uses the declaration beyond tests and static descriptors.
- **Change:** Use `toSorted()` or copy before sorting in `RunNodeSessionPanel`. Delete or sharply reduce comments defending removed `selectOneMark` behavior while preserving tested behavior. Either add a real consumer for `module.resources` or remove the required declaration until the module system uses it.
- **Tests:** Component/unit tests should prove input order is not mutated; maintainer mark tests should continue to pin behavior; view-registry tests must reflect whichever `resources` decision is taken.
- **Risk:** Low for the sort fix, medium for module descriptor contract churn.
- **Deps:** None.

#### WS-23 — Delete confirmed dead formula-name code and parallelize run-detail lookups  *(Claude P5)*

- **Implementation status (2026-06-01):** Complete. The dead `resolveRunFormulaName` / `ResolvedRunFormulaName` export and its duplicate documentation are gone; the useful behavior coverage now targets the live `resolveRunFormulaIdentity()` helper. The run-detail route now fetches sessions and formula detail concurrently after the run snapshot is loaded, and a route regression proves formula-detail starts before the delayed sessions response completes.
- **Why:** These are verified quick deletions/latency fixes from Claude's P5 list. They preserve behavior while removing stale parallel abstractions and one unnecessary upstream round-trip from every formula run detail load.
- **Evidence:** `resolveRunFormulaName` had no production callers; tests were the only remaining import. `backend/src/routes/runs.ts` awaited `getRunSessions(gc)` and then `getRunFormulaDetail(gc, raw, scope)` serially even though the latter depends on `raw` and the former depends only on `gc`.
- **Change:** Remove the legacy resolver and move tests onto `resolveRunFormulaIdentity()`. Compute run scope once, then `Promise.all([getRunSessions(gc), getRunFormulaDetail(gc, raw, scope)])`.
- **Tests:** Red structure test first proved the legacy resolver still existed; red route test first proved serial `sessions:start, sessions:end, formula:start` ordering. Focused tests now pass.
- **Risk:** Low. Fetch concurrency is bounded to two already-existing typed lookups whose errors are converted into unavailable states.
- **Deps:** Builds on WS-5.

#### WS-24 — Centralize duplicated run-edge transforms and semantic identity helpers  *(Claude P1 #2)*

- **Implementation status (2026-06-01):** In progress. First slice complete: `gc-supervisor-decoders.ts` now uses one `withRunId()` / `withRequiredRunId()` helper for supervisor `workflow_id → run_id` mapping across formula feeds, formula history, run snapshots, and sling responses; a structure test prevents the mapping from re-splitting. Larger follow-ups should handle step-ref semantic identity and the `ralph → check-loop` vocabulary map.
- **Why:** The same concepts are still implemented in several places and held together by comments: wire run id translation, semantic step/control identity, and product-term externalization.
- **Evidence:** `gc-supervisor-decoders.ts` maps `workflow_id → run_id` in four separate transforms/destructures. Step-ref identity overlaps across `runs/groups.ts`, `runs/node-shape.ts`, and `runs/formula-order.ts`. `ralph → check-loop` appears in ID externalization, kind mapping, and display text regexes.
- **Change:** Add one decoder-local wire rename helper first. Then extract `runSemanticId.ts` for semantic identity / alias variants, and one product-term map for wire-to-display vocabulary.
- **Tests:** Keep existing decoder/run graph tests green; add structure or focused tests around the helper so new mappings do not reintroduce local transforms.
- **Risk:** Medium for graph identity; low for the decoder-local helper.
- **Deps:** Coordinates with WS-10 cleanup and WS-8.

#### WS-25 — Move run-health cross-cycle state into `RunHealthEngine`  *(Claude P1 #3)*

- **Implementation status (2026-06-01):** Planned.
- **Why:** `snapshot/service.ts` is an orchestrator but owns cross-cycle `progressMarks`, the newer-generation gate, and the race invariant around enrichment. `snapshot/health.ts` already owns the pure health functions and is the cohesive place for the stateful engine.
- **Evidence:** `backend/src/snapshot/service.ts` still stores and updates the mark map and generation guard while `backend/src/snapshot/health.ts` exports the pure computation primitives.
- **Change:** Introduce a small `RunHealthEngine` in `health.ts` that owns mark storage and generation gating; `service.ts` calls `engine.enrich(...)`.
- **Tests:** Preserve existing snapshot health tests and add a focused cross-cycle test proving stale generations do not overwrite newer marks.
- **Risk:** Medium. This touches dashboard ambient status behavior, so keep the extraction small and behavior-preserving.
- **Deps:** None.

#### WS-26 — Table-drive phase and formula classification  *(Claude P2 #4)*

- **Implementation status (2026-06-01):** Planned.
- **Why:** Phase mapping and formula-stage classification encode precedence in physical `if` order. A typed rule table makes precedence explicit and reduces drift with run kind identity.
- **Evidence:** `mapRunPhase` is an ordered substring ladder, `stagesForFormula` is a long formula-name if-chain, `ROUND_IN_KEY` / `ROUND_IN_VALUE` are duplicate regexes, and `runKind` repeats formula identity.
- **Change:** Replace the phase ladder with ordered `PHASE_RULES`; replace formula stage branching with `FORMULA_STAGES: Record<KnownFormula, ...>` and derive run kind from the same table where possible.
- **Tests:** Convert existing phase/formula mapping tests to assert rule order and the duplicate-regex collapse; add one misclassification regression for descriptive text containing a later-stage word.
- **Risk:** Medium. Preserve order exactly first, then simplify.
- **Deps:** Best after WS-24 semantic identity cleanup.

#### WS-27 — Pull route view-state machines out of large frontend components  *(Claude P2 #5 + P4)*

- **Implementation status (2026-06-01):** Planned.
- **Why:** `FormulaRunDetail.tsx` and `AgentDetail.tsx` still derive several loading/error/ready booleans and fetch lifecycles inline. The list routes share primitives but still repeat the same search/chips/table/empty-state shell.
- **Evidence:** `FormulaRunDetail.tsx` composes route parsing, detail, diff, SSE refresh, selection, loading, refresh, and error derivation inline. `AgentDetail.tsx` owns session/bead/directives/chat/entity-link lifecycle state inline. `Agents`, `Beads`, and `Mail` repeat the same list shell.
- **Change:** First extract a `useFormulaRunView` discriminated union over route-error/loading/error/ready. Then migrate `AgentDetail` onto canonical data hooks. Treat `FilteredListSection<T>` as a later incremental extraction over existing shared primitives.
- **Tests:** Component tests should assert the same rendered route states before/after extraction. Prefer hook tests for the new discriminated union.
- **Risk:** Medium; UI behavior should not change.
- **Deps:** None.

#### WS-28 — Unify dashboard absence envelopes after schema coverage expands  *(Claude P3 #7)*

- **Implementation status (2026-06-01):** Planned.
- **Why:** `Avail<T>` is the canonical dashboard absence envelope, but a few DTOs still model availability with parallel booleans and string errors. Domain booleans from supervisor wire types are not part of this cleanup.
- **Evidence:** `shared/src/lists.ts` defines `Avail<T>` while `shared/src/gc-health.ts` uses `DoltNomsTrend.available`. `GcAgent.available` is a domain field and should remain unchanged.
- **Change:** After WS-16 expands schema coverage, move dashboard-owned availability envelopes toward `Avail<T>` / typed reasons where it improves guardrails without lying about supervisor domain fields.
- **Tests:** Shared DTO tests must prove the new envelope rejects malformed absence states and frontend consumers switch exhaustively on the discriminant.
- **Risk:** Medium because this is a shared DTO change.
- **Deps:** WS-16.

#### WS-29 — Migrate GC-owned frontend surfaces to the generated supervisor client  *(direct replacement architecture)*

- **Implementation status (2026-06-01):** Planned; this is now the preferred architecture for replacing the built-in `gascity` dashboard.
- **Why:** The current dashboard-server GC facade duplicates the supervisor contract, creates a second DTO authority, and forces the codebase to maintain generated types, hand validators, shared mirror DTOs, frontend decoders, route projections, partial-list metadata copying, cache keys, and vocabulary translation. The existing `gascity` dashboard proves the simpler ownership model: generated browser client over supervisor OpenAPI, with server code limited to static hosting and non-supervisor capabilities.
- **Evidence:** Current production LOC directly tied to the extra layer includes `backend/src/gc-client.ts` (~1,009), `backend/src/gc-supervisor-decoders.ts` (~920), GC mirror routes (`routes/agents.ts`, `beads.ts`, `mail.ts`, `sessions.ts`, `events.ts`, `session-stream.ts`, `snapshot.ts`, and large parts of `runs.ts`) at roughly 1.4k-2.0k LOC, supervisor mirror DTO leaves under `shared/src/gc-*.ts` plus `formula-runs.ts` (~650), and the GC half of `frontend/src/api/client.ts` (~250-350 net after replacement). These are not all deleted in one PR, but they are the target deletion pool.
- **Change:**
  1. Generate a browser-consumable supervisor client from the committed supervisor OpenAPI, modeled on `~/code/gastownhall/gascity/cmd/gc/dashboard/web/openapi-ts.config.ts`. Reuse the same generator family as backend work where possible.
  2. Add a tiny frontend supervisor-client wrapper for base URL discovery, mutation headers, error normalization, and test injection. The wrapper must not redefine response DTOs.
  3. During standalone development, use Vite or the dashboard service as a **transport-only** `/v0/*` proxy if same-origin/CSP/SSH forwarding requires it. The proxy may forward bytes and headers; it must not validate, map, strip, cache, or translate GC DTOs.
  4. Migrate surfaces in deletion-friendly slices: health/cities, sessions/transcripts/session stream, agents, beads/claim/close/nudge, mail/send/thread, events/activity/snapshot refresh, formula feeds, Formula Run Detail snapshot/projection, and finally run diff split so local git evidence remains dashboard-service-owned.
  5. Delete the corresponding backend `/api/city/:cityName/*` GC mirror routes, `GcClient` methods, `gc-supervisor-decoders.ts` schemas, shared supervisor mirror DTOs, and route/mock tests as each surface moves.
  6. Keep or add dashboard-service `/api/*` routes only for host-local or external-tool capabilities: `git`, `gh` maintainer triage, local build logs, dolt-noms host sampling, admin process health, client-error telemetry, and static runtime config.
- **Tests:** Red-green per slice. Start each migration by failing a component/hook test that still calls a dashboard `/api/city/*` GC mirror route, then switch it to the generated supervisor client. Add a structure test or grep gate once a surface is migrated so it cannot reintroduce a dashboard mirror. Keep focused browser harnesses green for Formula Run Detail and any route whose transport changes.
- **Risk:** Medium-high but simplifies the system. Main risks are browser-safe supervisor transport, supervisor OpenAPI accuracy, and missing supervisor capabilities. Those are tracked in [`../gc-supervisor-api-gaps.md`](../gc-supervisor-api-gaps.md) and should be fixed upstream rather than hidden behind new dashboard-server adapters.
- **Deps:** Requires the upstream API gaps that block direct use, especially close-with-reason, agent nudge, agent prime, canonical run presentation, session identity, and accurate OpenAPI schemas. Coordinates with WS-10, WS-15, WS-16, and WS-17 by deleting their target code rather than polishing it.

---

## Lower-priority cleanups (fold in opportunistically; not standalone PRs)

- **`useVisibleRefresh` vs `useAbortableVisibleRefresh`** duplicate the backoff state machine (`useVisibleRefresh.ts:37-61` vs `useAbortableVisibleRefresh.ts:44-90`). Extract `useVisibleBackoffTick({enabled,intervalMs,run,...})`; build both on top. *(TN hooks #3)*
- **`useLiveCachedData` composite** — `useCachedData(...).refresh` + `useGcEventRefresh(prefix, refresh)` is copy-pasted per route (`Beads.tsx:36,65`; `Agents.tsx:124,159`; `Runs.tsx:52,117`). Promote one hook. *(TN routes #2 / hooks #2)*
- **`ViewingAsContext` over-defensiveness** — `getSessionsRetryDelay` is ~45 lines of comment guarding a 3-element lookup (`:69-100`); the provider fuses alias-selection, sessions-retry, mail+sessions prefetch, and StrictMode bookkeeping (`:146-376`). Extract `useAliasRoster()` so the security-relevant impersonation logic isn't buried in retry/join plumbing. *(TN hooks #6/#7)*
- **Comment-archaeology / dead scaffolds** — `triage.ts:412-451 selectOneMark` carries ~25 lines refuting deleted code (violates "no comments for removed functionality"); `slung-state.ts:27-45,135-212` is ~90 lines of legacy-normalization scaffold to default one optional field. Delete the archaeology; collapse the scaffold to a single `?? null` at the read edge. *(TN maintainer #7/#8)*
- **`AgentDetail.tsx`** hand-rolls 4 parallel fetch/loading/error state machines instead of `useCachedData` (`:54-58,83-120,205-243`). Migrate to the canonical hook. *(TN routes #1/#5)*
- **`run-snapshot.ts:48,50`** `Record<string,never>[]` is `any` in disguise for `logical_nodes`/`scope_groups` — type honestly as `readonly unknown[] | null` or model the real shape. *(TN shared #7)*

## Explicitly NOT in scope (rejected to keep the plan high-conviction)

- A "unified entity chip" across `RelatedEntities` / `TriageSections` / run panels — they render genuinely different wire shapes; a shared model would be speculative (YAGNI).
- `RunNodeSessionPanel.tsx` (335) — dense but legitimately so; cleanest of the large files.
- Generated supervisor artifacts — change generator inputs, never hand-edit.
- The read-edge architecture (single decode chokepoint, single-flight coalescing, n6f1 degrade-not-collapse) — genuinely good; preserve it.

---

## Sequencing & dependency graph

```
Tier 0 (vocabulary)      WS-1 ─┐
                         WS-2 ─┼─► (unblocks run vocab; WS-2 coordinates w/ WS-10 normalization)
Tier 1 (quick wins)      WS-3, WS-4   (independent, parallelizable, ship first for momentum)
Tier 2 (resolvers)       WS-5 ─┐
                         WS-6 ─┼─► WS-8 (collector split consumes WS-5 + WS-6)
                         WS-7   (independent)
Tier 3 (decomposition)   WS-10 G-0 (Node 22/tooling) ─► WS-10 G-1a (generate @hey-api)
                         ─► WS-10 G-1b/G-3 (hard cutover + generated Zod validation) ─► WS-10 cleanup (upstream schema sync + delete temporary adapter)
                         WS-9 (after WS-2 + WS-10 G-1b), WS-11 (after WS-3), WS-14 (complete)
Tier 4 (correctness)     WS-12 (complete), WS-13 (getStatus/decodeSling folded into WS-10 G-3)
Tier 5 (current review)  WS-29 (architecture pivot: direct supervisor first)
                         WS-20, WS-21 (guardrails first)
                         WS-18, WS-19, WS-22 (small behavior/quality fixes)
                         WS-23 (Claude P5 quick fixes; complete)
                         WS-15 + WS-16 + WS-17 (transitional only where WS-29 has not deleted the surface)
                         WS-24 ─► WS-10/WS-29 cleanup
                         WS-28 (dashboard-owned envelopes only)
                         WS-25, WS-26, WS-27 (larger validated refactors)
```

**Recommended order:** WS-1, WS-2 → WS-3, WS-4 (quick wins, reverse drift) → WS-5, WS-6, WS-7 (canonical resolvers/policy) → **WS-10 G-0/G-1a/G-1b/G-3** (Node 22/tooling, generate with @hey-api, hard-cut to the generated SDK, delete the old client stack, enable strict generated-Zod response validation) + WS-13 cheap-correctness items → WS-8, WS-9, WS-12 and WS-14 (complete), WS-11 (decomposition) → **WS-29 spec and first migration slice** → **WS-20/WS-21 guardrails** → **WS-18/WS-19/WS-22/WS-23 small fixes only where not deleted by WS-29** → **WS-24** for remaining composed run transforms → **WS-15/WS-16/WS-17 only as transitional paydown** → WS-25/WS-26/WS-27/WS-28 as larger follow-on refactors. The migration preference is delete the dashboard-server GC layer, not harden it.

Land each workstream as its own PR against `main` with passing CI. Several are parallelizable across branches (WS-3, WS-4, WS-7 touch disjoint files; WS-14 has already landed in this branch).

## Validation gate (run before every push)

```
npm run build:shared
npm --workspace shared run typecheck:test
npm --workspace shared test
npm run openapi:gc-supervisor:check
npm run typecheck
npm run lint
npm --workspace frontend run build
npm --workspace backend test
npm --workspace frontend test
```

Root `npm run typecheck` already includes backend and frontend test typechecks, and generated supervisor client code is intentionally inside the backend TypeScript project. `npm run lint` uses `--max-warnings=0` and no longer ignores `backend/src/generated`, so generated-client lint warnings fail the same gate as source warnings. `npm run build:shared` is listed separately to mirror CI setup order even though `typecheck:src` also builds shared. For WS-10 generator work, also run `npm run openapi:gc-supervisor:generate` before the check and commit generated artifacts.

For run-detail-affecting workstreams (WS-5, WS-6, WS-7, WS-8, WS-12), also run the focused harness against a live dev server:

```
npm run dev:frontend   # default target: 127.0.0.1:5174; override harness with SNAP_BASE
node scripts/snap-formula-run-detail.mjs --test
```

## Resolved decisions (locked via `/grill-me` against the specs + the upstream `gascity` dashboard)

1. **WS-12 tab behavior — DECOUPLE.** Tab is explicit user state; selecting a node no longer auto-switches to Session. Rewrite the locked test. *(Overrode the "keep auto-switch" recommendation; the diff being node-independent made the call genuinely debatable, but the user chose Codex's model.)*
2. **WS-12 resource shape — SPLIT into two hooks** (`useFormulaRunDetail` + `useRunDiff`). *(Overrode the spec's single-hook `ready={detail,diff}` model — spec amendment required.)*
3. **WS-2 `TriageItem` field — `run_id`.** Spec Naming Boundary L62 mandates uniform `runId`/`run_id` dashboard vocabulary; the "best-known-at-sling-time, not live" nuance stays in the JSDoc; fix the stale `/workflows/<id>` → `/runs/<id>` reference.
4. **No backwards compatibility for dashboard routes or DTOs.** The browser client in this repo is the only consumer of the backend service. Delete old routes/fields instead of redirecting or aliasing them.
5. **WS-10 supervisor edge — GENERATE from OpenAPI.** Adopt `@hey-api/openapi-ts`, modeled on gascity's dashboard. **Enable the Zod plugin** where runtime validation is needed. Fix accuracy **upstream** in gascity's OpenAPI. Phased G-0/G-1a/G-1b/G-2/G-3; no permanent parallel hand-written supervisor client, and G-1b must delete the old `openapi-typescript`/`openapi-fetch`/hand-decoder stack rather than preserving it.
6. **WS-29 dashboard replacement direction — BROWSER DIRECT TO SUPERVISOR.** For GC-owned surfaces, the generated supervisor client belongs in the frontend. The dashboard service is not a permanent supervisor facade; it remains for `git`, `gh`, local build/log/host evidence, client telemetry, static serving, and optional transport-only proxying. Missing supervisor capabilities are upstream Gas City work, tracked in [`../gc-supervisor-api-gaps.md`](../gc-supervisor-api-gaps.md).

### Follow-on consequences (architecture-determined; no further decision needed)

- **The generated supervisor SDK is no longer backend-only as an architectural rule.** Backend generation can remain for transitional/server-only calls, but browser-facing GC surfaces should use a browser-generated supervisor client directly. Runtime validation should be generated from OpenAPI where the transport layer does not already provide a typed parse boundary.
- **WS-9 split the shared barrel without adding subpath API churn.** Remaining raw supervisor-wire mirror removal is now a WS-29 cleanup concern: direct generated supervisor usage should let `shared` keep only dashboard-owned service DTOs, UI/module contracts, and local/composed view models.
- **The architecture specs have been amended**: `specs/architecture/overview.md`, `security.md`, `extending.md`, `module-author-checklist.md`, and `formula-run-detail-type.md` now describe the direct-supervisor target, dashboard-local service scope, generated browser supervisor client, transport-only proxy allowance, and tab-as-user-state model. `specs/requirements/modular-dashboard-prd.md` is marked as predating the pivot and treats `CityContext.gc` as transitional.

### Remaining risk to watch

- **The Node 22/tooling move (WS-10 G-0)** is a hard prerequisite for current `@hey-api/openapi-ts`.
- **The remaining cross-repo accuracy dependency (WS-10 G-2)** is source-of-truth landing: the upstream work is consolidated in [`../gc-supervisor-api-gaps.md`](../gc-supervisor-api-gaps.md). Land those Gas City fixes before deleting the temporary DTO adapter, so future `openapi:gc-supervisor:update` runs do not reintroduce drift.

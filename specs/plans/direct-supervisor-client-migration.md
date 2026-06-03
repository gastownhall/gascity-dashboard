# Direct Supervisor Client Migration

Date: 2026-06-01
Status: In progress

## Goal

This project is intended to replace the existing `gc dashboard` implementation
inside `gastownhall/gascity`. The replacement should therefore follow the same
ownership model for Gas City data: the browser uses the GC supervisor API
directly for GC-owned resources, generated from supervisor OpenAPI, and the
custom dashboard service exists only for capabilities that are not supervisor
API responsibilities.

## Target Boundary

### Browser to GC supervisor

Use a generated supervisor client for:

- cities and runtime config that come from supervisor state
- health, agents, sessions, transcripts, and session streams
- beads and bead mutations
- mail reads, threads, sends, replies, archive, and read-state mutations
- activity/events and snapshot refresh signals
- formula feeds, formula run snapshots, formula detail, and run event streams
- any future GC primitive once it is exposed in supervisor OpenAPI

The frontend may derive view models in hooks/selectors, but it must not define
a second wire contract for supervisor resources.

### Browser to dashboard service

Keep dashboard-service `/api/*` only for data the supervisor should not own:

- `git` log, status, diff, and execution-folder evidence
- `gh` maintainer triage and contributor history
- local deploy/build logs
- host/process health and dolt-noms local filesystem sampling
- client-error telemetry and dashboard audit rows
- static runtime config needed to discover the supervisor URL or enabled local
  dashboard modules

The dashboard service may also provide a transport-only proxy for supervisor
paths when same-origin development, CSP, or SSH forwarding requires it. In this
standalone repo that proxy is mounted at `/gc-supervisor/*` and forwards
supervisor `/health` plus `/v0/*`. Such a proxy must not validate, map, strip,
cache, rename, or otherwise own supervisor DTOs.

## Non-Goals

- No permanent dashboard-server GC facade.
- No new shared DTO mirrors for supervisor-owned lists or entities.
- No backend "DTO stripping" layer for fields that the browser can safely
  receive from the supervisor.
- No dashboard-side OpenAPI patches as a long-term substitute for fixing
  `gastownhall/gascity` Huma/OpenAPI source.

## Upstream Dependency Rule

When direct use is blocked because the supervisor does not expose a needed
capability or its OpenAPI schema is inaccurate, add or update the gap in
[`../gc-supervisor-api-gaps.md`](../gc-supervisor-api-gaps.md), then implement
the fix in `gastownhall/gascity`. The dashboard may carry temporary migration
glue, but that glue must include a deletion condition tied to the upstream gap.

## Migration Slices

1. **Generated browser client foundation**
   - Generate a browser-consumable supervisor client from the committed
     supervisor OpenAPI.
   - Add a tiny wrapper for base URL discovery, mutation headers, error
     normalization, and test injection.
   - Model this on the current `gascity` dashboard rather than the
     dashboard-server `GcClient`.

2. **Transport**
   - In folded-back `gascity`, use the supervisor/static hosting shape already
     used by the existing dashboard.
   - In this standalone repo, use Vite or the dashboard service as a
     transport-only proxy when direct browser access to `127.0.0.1:8372` is
     inconvenient.
   - The standalone dashboard-service proxy is mounted under
     `/gc-supervisor/*`, forwarding only supervisor `/health` and `/v0/*`
     paths. The prefix avoids colliding with the dashboard application's own
     `/health` route while preserving generated supervisor paths below the
     prefix.
   - Keep CSP explicit. If `connect-src` includes the supervisor origin, name
     it; if the proxy is used, keep `connect-src 'self'`.

3. **Simple reads**
   - Migrate health, cities, sessions, agents, beads, mail, and activity reads
     from dashboard `/api/city/:cityName/*` routes to the generated supervisor
     client.
   - Delete corresponding route code and shared mirror DTOs as each surface
     moves.

4. **Streams**
   - Migrate city events and session streams to direct supervisor EventSource
     when CSP/transport allows.
   - If a same-origin stream proxy remains, it is transport-only and must not
     parse event payloads.

5. **Writes**
   - Migrate claim/send and any already-supported writes directly.
   - Close-with-reason is implemented after `GC-10`: the Beads page calls the
     generated supervisor close endpoint with the optional reason body and the
     dashboard close route is gone.
   - Agent nudge is implemented after `GC-11`: the Beads page calls the
     generated supervisor agent action endpoint with the mutation header and
     the dashboard nudge route is gone.
   - Agent prime is implemented after `GC-12`: Agent Detail calls the
     generated supervisor prime endpoint and the dashboard prime route is gone.

6. **Formula Run Detail**
   - Prefer supervisor-owned run snapshot, formula detail, session identity,
     and graph presentation fields.
   - Keep local view-model derivation only where
     [`../gc-supervisor-api-gaps.md`](../gc-supervisor-api-gaps.md) says the
     supervisor does not yet expose the canonical shape.
   - Keep execution-folder git diff in the dashboard service; it is local
     filesystem evidence, not a supervisor responsibility.

7. **Deletion gates**
   - After a surface migrates, add a grep or structure test preventing the old
     dashboard mirror route from returning.
   - Delete related `GcClient` methods, hand decoders, shared mirror DTOs, and
     route-level mocks in the same slice.

## Implementation Plan

### Phase 0 — Lock The Boundary

Deliverables:

- Add an architecture test or lint/grep check that classifies routes as either
  dashboard-local `/api/*` or transport-only `/gc-supervisor/*`.
- Document the allowed dashboard-local route inventory in code:
  `git`, `gh`/maintainer, builds, host/process/dolt health, config,
  client-errors, and static frontend serving.
- Add a failing structure test for one GC mirror endpoint proving it still
  exists before migration begins.

Acceptance:

- New GC-owned backend routes require an explicit test failure or spec update.
- The first migrated route can delete its mirror without ambiguity.

### Phase 1 — Browser Supervisor Client Foundation

Deliverables:

- Add frontend supervisor OpenAPI generation. **Implemented for the committed
  schema; `openapi:gc-supervisor:check` now checks backend and frontend
  generated clients.**
- Add a tiny `frontend/src/supervisor/client.ts` wrapper for base URL discovery,
  mutation headers, error shape normalization, and test injection. **Implemented
  for health and city discovery as the first call sites.**
- Decide standalone transport:
  - direct `GC_SUPERVISOR_URL` in `connect-src`, or
  - dashboard-service transport-only `/gc-supervisor/*` proxy. **Implemented
    for standalone: the proxy forwards supervisor `/health` and `/v0/*` only.**
- Add generated-client drift check to CI.

Acceptance:

- A frontend unit test can mock the wrapper without importing dashboard
  `/api/*`.
- A smoke test can call supervisor health through the generated client.

### Phase 2 — Simple Read Surfaces

Order:

1. health/cities. **Implemented: browser city discovery now uses
   `/gc-supervisor/v0/cities`; Health composes generated supervisor
   `/v0/city/{cityName}/health` with dashboard-local `/api/health/system`.
   The dashboard city health mirror route, `GcClient.health`, shared
   `SupervisorHealth` DTO, and health decoder were removed.**
2. sessions/transcript reads. **Implemented for browser-facing reads:
   Agents, Agent Detail, Beads live-run resolution, Viewing-As alias
   prefetch, LiveSessionPeek, and Formula Run Detail transcript snapshots
   call the generated supervisor client for `/v0/city/{cityName}/sessions`
   and `/v0/city/{cityName}/session/{id}/transcript`. Agents pending
   interaction reads also call
   `/v0/city/{cityName}/session/{id}/pending` through the generated client,
   and pending approve/deny writes call
   `/v0/city/{cityName}/session/{id}/respond` directly through the generated
   client with the dashboard mutation header. The dashboard
   `/api/city/:cityName/sessions` mirror and `/peek` route were removed.
   `GcClient.listSessions()` / `fetchTranscript()` remain transitional
   backend-only dependencies for composed dashboard-local routes and
   snapshot/run enrichment until those surfaces migrate.**
3. agents. **Implemented for browser-facing reads: the Agents page now calls
   the generated supervisor client for `/v0/city/{cityName}/agents`, and the
   dashboard `GET /api/city/:cityName/agents` roster mirror was removed.
   `GcClient.listAgents()` remains a transitional backend-only dependency for
   snapshot/city-status enrichment until that surface migrates.**
4. beads list/detail. **Implemented for browser-facing reads: Beads and
   Agent Detail now call the generated supervisor client for
   `/v0/city/{cityName}/beads`, and bead detail fetches
   `/v0/city/{cityName}/bead/{id}` with the existing list-fallback behavior
   preserved client-side for supervisor detail 404s. The dashboard
   `GET /api/city/:cityName/beads` and
   `GET /api/city/:cityName/beads/:id` mirrors were removed. Claim and
   targeted create-and-sling now use generated supervisor writes directly.
   Rig filtering uses the generated supervisor `rig` query rather than a
   dashboard-owned filter route.
   Close now uses the generated supervisor endpoint with an optional reason
   body after `GC-10`; nudge now uses the generated supervisor agent action
   endpoint after `GC-11`; the dashboard close and nudge routes were removed.
   `GcClient.listBeads()` and `getBead()` remain transitional backend-only
   dependencies for the backend-local snapshot/run collector tail until that
   composed surface is removed or replaced by upstream supervisor facts.**
5. mail list/thread. **Implemented for browser-facing reads: Mail,
   Viewing-As alias prefetch, and Agent Detail chat now call the generated
   supervisor client for `/v0/city/{cityName}/mail` and
   `/v0/city/{cityName}/mail/thread/{id}`. The dashboard
   `GET /api/city/:cityName/mail` and
   `GET /api/city/:cityName/mail/threads/:id` mirrors were removed.
   Mailbox alias/box filtering remains a frontend view selector over
   generated `Message` objects so the browser keeps the supervisor wire type
   instead of receiving a dashboard-owned mail DTO. All-traffic mode is also a
   frontend selector over the same generated list, not a dashboard DTO. Mail
   now has an explicit history-depth selector that changes the generated
   supervisor `limit` query. Mail send is implemented directly through the
   generated supervisor client; the dashboard `/api/city/:cityName/mail-send`
   route and mail-send DTOs were removed.**
   Focused-route attention highlighting for Runs, Agents, Beads, and Mail now
   keys off generated supervisor entities or their transitional client-side
   run projection directly and adds no dashboard DTO strip/projection layer.
6. activity/events reads. **Implemented for both existing event refresh and
   human-facing event history: `useGcEventRefresh` now opens
   `/gc-supervisor/v0/city/{cityName}/events/stream` through the supervisor
   transport path, and Activity reads `/v0/city/{cityName}/events` through the
   generated supervisor client. Activity event attention deep-links to the
   route's generated-query event type filter instead of requiring a dashboard
   event DTO projection. The dashboard
   `GET /api/city/:cityName/events/stream` mirror was removed. Activity's
   dashboard-local `/api/*` usage is now limited to project/dev activity
   (`git` commits and deploy logs).**

Per-surface red-green loop:

- Start with a failing test that asserts the route/hook still calls
  `api.listX()` or `/api/city/:cityName/x`.
- Move the hook/component to the generated supervisor client.
- Delete the backend mirror route, related `GcClient` method, shared mirror
  DTO, and route test mocks for that surface.
- Add a structure test that the deleted mirror route is not mounted.

Acceptance:

- The UI still renders the same state from generated supervisor types.
- No dashboard-owned DTO exists for the migrated supervisor resource.

### Phase 3 — Streams And Invalidation

Deliverables:

- Move city event streams to direct supervisor EventSource where transport
  allows. **Implemented for `useGcEventRefresh` via the `/gc-supervisor`
  transport path.**
- Move selected-session streams the same way. **Implemented for
  `useSessionStream`: selected transcript panels now open
  `/gc-supervisor/v0/city/{cityName}/session/{id}/stream`, and the dashboard
  `/api/city/:cityName/session-stream/:id/stream` proxy was removed.**
- If the proxy remains, keep it on a transport-named path and remove event
  payload parsing from the dashboard service. **Implemented for city and
  selected-session events; the standalone transport relay is
  `/gc-supervisor/*`.**

Acceptance:

- Event identity matching happens in frontend code over generated supervisor
  event types.
- The backend stream proxy, if present, can be tested as byte forwarding only.

### Phase 4 — Writes And Upstream Gaps

Order:

1. claim and existing supervisor-supported writes. **Claim implemented:
   Beads now PATCHes `/gc-supervisor/v0/city/{cityName}/bead/{id}` with
   generated supervisor types and `X-GC-Request`; the dashboard
   `/api/city/:cityName/beads/:id/claim` route and backend `GcClient.updateBead`
   helper were removed.**
2. targeted bead create-and-sling. **Implemented: Beads creates a bead through
   `/gc-supervisor/v0/city/{cityName}/beads` and dispatches it through
   `/gc-supervisor/v0/city/{cityName}/sling`, using generated request/response
   types and `X-GC-Request`. No dashboard-service DTO or route was added.**
3. mail send. **Implemented: Compose posts
   `/gc-supervisor/v0/city/{cityName}/mail` with generated supervisor types,
   `from: "human"`, and `X-GC-Request`; the dashboard
   `/api/city/:cityName/mail-send` route, backend `GcClient.sendMail`, and
   shared mail-send DTOs were removed.**
4. mail reply/archive/read-state. **Implemented: Mail thread actions call the
   generated supervisor endpoints for reply, archive, mark-read, and
   mark-unread with generated request/response validation and `X-GC-Request`.
   No dashboard-service mail action DTO or route was added.**
5. close-with-reason after `GC-10`. **Implemented: the browser calls
   `/gc-supervisor/v0/city/{cityName}/bead/{id}/close` with the generated
   optional reason body and `X-GC-Request`; the dashboard
   `/api/city/:cityName/beads/:id/close` route and close subprocess wrapper
   were removed.**
6. agent nudge after `GC-11`. **Implemented: the browser calls
   `/gc-supervisor/v0/city/{cityName}/agent/{base}/nudge` or the qualified
   `{dir}/{base}` variant with `X-GC-Request`; the dashboard
   `/api/city/:cityName/beads/:id/nudge` route and nudge subprocess wrapper
   were removed.**
7. agent prime after `GC-12`. **Implemented: Agent Detail calls
   `/gc-supervisor/v0/city/{cityName}/agent/{base}/prime` or the qualified
   `{dir}/{base}` variant through the generated browser supervisor client.
   The dashboard `/api/city/:cityName/agents/:alias/prime` route and
   `execAgentPrime` subprocess wrapper were removed.**

Acceptance:

- No `gc` subprocess wrapper remains in `backend/src/exec.ts`; close, nudge,
  and prime are off the dashboard subprocess path.
- Dashboard-service writes are limited to local dashboard resources.
- Supervisor mutation calls use generated request types and the supervisor's
  browser-safe mutation header/auth model.

### Phase 5 — Formula Run Detail

Deliverables:

- Fetch formula feed data through the generated supervisor client for
  city-wide Runs attention. **Implemented for the App-level attention model:
  Home/nav Runs attention reads
  `/v0/city/{cityName}/formulas/feed` through the browser supervisor wrapper,
  and the focused `/runs` list route now builds its run summary from browser
  supervisor bead/feed/session reads through `loadSupervisorRunSummarySource`.
  The dashboard snapshot route/client were removed.**
- Fetch run snapshot, formula detail, sessions, and event identity through the
  generated supervisor client. **Implemented for the page's supervisor-owned
  inputs: `useFormulaRunDetail()` now calls the browser supervisor wrapper for
  `/v0/city/{cityName}/workflow/{workflow_id}`, session list/transcript
  resolution, formula detail, city event invalidation, and selected-session
  streams.**
- Keep local git diff as a separate dashboard-service resource. **Implemented:
  `useRunDiff()` is still the independent `/api/city/:cityName/runs/:runId/diff`
  resource because it reads local execution-folder git state.**
- Move projection logic client-side only where still necessary, or delete it
  when `GC-1` through `GC-7` provide canonical upstream presentation.
  **Implemented as transitional shared projection code in `shared/src/runs/*`,
  consumed by the browser so the dashboard service no longer mirrors the run
  detail DTO.**
- Delete `/api/runs/:runId` once the browser can compose the page from
  supervisor data plus local diff. **Implemented: the old dashboard
  formula-run detail mirror is no longer mounted; the runs route only serves
  local diff.**

Acceptance:

- Formula Run Detail no longer depends on `backend/src/routes/runs.ts` for
  supervisor data.
- Local diff failure cannot break supervisor run-detail loading.
- The browser harness passes against generated supervisor data and local diff.

### Phase 6 — Shared And Backend Cleanup

Deliverables:

- Delete `backend/src/gc-client.ts` or reduce it to server-only transitional
  calls with a deletion issue.
- Delete `backend/src/gc-supervisor-decoders.ts`.
- Delete supervisor mirror DTO leaves under `shared/src/gc-*.ts` and
  `shared/src/formula-runs.ts` once no consumers remain.
- Shrink `frontend/src/api/client.ts` to dashboard-local service routes only.
- Remove route-level tests that mocked supervisor mirrors; replace with
  generated-client wrapper tests and component tests.

Implementation status:

- Mail/event cleanup is implemented for the migrated surfaces:
  `GcClient.listMail()`, `GcClient.listEvents()`,
  `gcSupervisorDecoders.listMail()`, `gcSupervisorDecoders.listEvents()`,
  the backend hand-rolled mail/event schemas, and shared `gc-mail` /
  `gc-events` DTO leaves were deleted. Structure tests now prevent
  reintroducing those dashboard-server mirrors.
- Agent roster cleanup is implemented for the transitional backend reads:
  `GcClient.listAgents()` and `getAgent()` now return generated supervisor
  `ListBodyAgentResponse` / `AgentResponse` types, frontend agent helpers use
  the generated browser `AgentResponse`, and the shared `gc-agents` DTO leaf
  was deleted. Structure tests prevent reintroducing that shared mirror.
- Rig roster cleanup is implemented for the transitional city-status read:
  `GcClient.listRigs()` now returns generated supervisor
  `ListBodyRigResponse`, the city-status collector projects generated
  `RigResponse` to its dashboard-owned `CityRig` shape, and the shared
  `gc-rigs` DTO leaf was deleted. Structure tests prevent reintroducing that
  shared mirror.
- Status cleanup is implemented for the transitional dolt-noms sampler:
  `GcClient.getStatus()` now returns generated supervisor `StatusBody`, the
  sampler depends on that generated type, and the shared `GcStatus` /
  `StatusStoreHealth` mirror was deleted from `gc-health`. Structure tests
  prevent reintroducing that shared mirror.
- Formula/order cleanup is implemented for the transitional run discovery
  path: `GcClient.listFormulaRuns()` now returns generated supervisor
  `FormulaFeedBody`, run discovery consumes `workflow_id` directly, the shared
  `formula-runs` DTO leaf was deleted, and the unused future-pinned
  `listFormulaRunsByName`, `listOrdersFeed`, `listOrderHistory`, and
  `getOrderHistoryDetail` wrappers were removed. Structure tests prevent
  reintroducing those dashboard-server mirrors.
- Run summary and related-entity cleanup is implemented for browser-facing
  reads: `/runs`, Home, Formula Run Detail skeletons, and related entities now
  compose from generated browser supervisor calls plus shared projection
  helpers; `/api/city/:cityName/snapshot`, `/snapshot/refresh`,
  `/links/:ref`, and `/home/pending/stream` route modules/mounts were removed.
- Remaining cleanup is intentionally transitional: `GcClient`,
  `gc-supervisor-decoders`, and the remaining shared GC leaves still support
  backend-local snapshot/run collector tests and local health enrichment until
  the upstream gaps or final client-side composition work are finished. Agent
  prime, links, and browser-facing run summaries are no longer part of that
  backend tail.

Acceptance:

- `rg "GcClient|gc-supervisor-decoders|/api/city/.*/(agents|beads|mail|sessions|events|snapshot)"` is clean except for archived docs or explicit migration notes.
- `shared/` contains no supervisor wire mirror types. **Partially achieved:
  mail/event/agent/rig/status/formula/order mirror leaves are gone; remaining
  GC/shared leaves are tracked by the transitional cleanup item above.**
- The LOC deletion target in this plan is materially achieved.

## Expected Simplification

Measured from current `origin/main`, the production deletion pool is roughly:

- `backend/src/gc-client.ts`: about 1,009 LOC.
- `backend/src/gc-supervisor-decoders.ts`: about 920 LOC.
- GC mirror routes for agents, beads, mail, sessions, events, streams,
  snapshot, and large parts of runs: about 1.4k-2.0k LOC.
- Supervisor mirror DTO leaves in `shared/src/gc-*.ts` and
  `shared/src/formula-runs.ts`: about 650 LOC.
- GC-specific parts of `frontend/src/api/client.ts`: about 250-350 net LOC
  after a smaller dashboard-service client remains.

That gives a conservative production-code simplification of **3.8k-5.4k LOC
net removed**, before counting tests. Test and fixture deletion should be
larger, likely **4k-7k LOC**, because mocked backend routes for supervisor
resources disappear.

Measured progress in this branch already removes about **2.4k+ LOC** from the
main deletion pool before counting tests: selected GC mirror routes shrink by
about 1.2k LOC, shared supervisor mirror leaves by about 420 LOC,
`GcClient`/decoder code by about 670 LOC, and GC-specific frontend API client
code by about 140 LOC before the final prime-route deletion. The remaining
savings come from deleting the transitional `GcClient`/decoder tail and
composed backend snapshot/run mirrors once their client-side or
upstream-supervisor replacements are complete.

The reliability improvement is qualitative as much as numeric:

- one fewer network hop for GC data
- one fewer cache layer to go stale
- no duplicated supervisor DTO contracts
- no partial/degraded metadata copied through route projections
- no generated-type vs hand-Zod vs shared-DTO vs frontend-decoder mismatch
- fewer opportunities to strip or redact the wrong field
- missing capabilities become explicit upstream API gaps instead of hidden
  dashboard compensations

## Red-Green Discipline

Each migration slice starts with a failing test that proves the old dependency
still exists or the new generated-client path is not wired. Then the slice
migrates the smallest coherent surface and deletes the old path before going
green. A slice is not complete if both the direct supervisor path and the old
dashboard mirror remain as permanent alternatives.

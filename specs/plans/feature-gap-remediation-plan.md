# Plan: Standalone Feature Gap Remediation

Date: 2026-05-31
Status: In progress; Phase 0 foundation, Phase 1 live attention wiring including stale agent/bead/mail thresholds and Maintainer triage facts, focused-route highlights, core Mail workspace writes/history-depth controls, Activity supervisor event-history viewing and filtered event deep links, Agents pending-interaction read/respond affordance, and Beads targeted dispatch/rig filtering implemented
Source analysis: [`../feature-gap-analysis.md`](../feature-gap-analysis.md)

## Goal

Address the legacy-dashboard gaps we chose to fill in the standalone
`gascity-dashboard`, without recreating the legacy one-page command center or
expanding into fold-back work that belongs in the main `gascity` repo.

The product target is:

- Home summarizes abnormal city state at a glance.
- Nav tabs show themed attention/watch indicators for their domains.
- Focused tabs remain complete domain workspaces, with attention highlighted
  but non-attention data still visible and interactable.
- The frontend owns the attention model through domain contributors.
- GC-owned reads and supported writes go through the generated supervisor
  client directly; the backend serves dashboard-local data and audited local
  write endpoints for `git`/`gh`/host capabilities.

## Non-Goals

- `gc dashboard` launch/packaging integration.
- Legacy supervisor/fleet/no-city command-center mode.
- Legacy one-screen wall of panels.
- Full bead administration parity: reopen, priority/label editing, broad
  assign/unassign, escalations, queues, and assigned-work admin.
- Dedicated convoy workspace.
- Service/rig restart, suspend, or resume controls.
- Run/order execution controls.
- Command palette, raw JSON inspectors, global output panel, or global action
  log.

## Architecture Principles

1. **Attention is client-owned.** Backend DTOs expose facts; frontend
   contributors decide what is attention/watch.
2. **Attention controls prominence, not visibility.** Focused views show full
   relevant datasets with reasonable defaults.
3. **One composed model.** Home, nav, and route highlights must consume the same
   attention facts so they cannot disagree.
4. **Domain ownership stays local.** Each domain owns its attention derivation
   close to its route/data model, then registers contributions into the shared
   composer.
5. **Writes follow ownership.** GC mutations use generated supervisor request
   types and the supervisor's mutation/audit model when the API supports the
   operation. Dashboard-service mutations are limited to dashboard-local
   `git`/`gh`/host capabilities and keep CSRF/origin protection, audit logging,
   and local UI feedback.
6. **Design stays quiet.** Attention/watch indicators use the dashboard's
   maroon/ochre language, words/glyphs, and greyscale-readable treatment rather
   than generic red/yellow dot clutter.

## Phase 0: Attention Model Foundation

Build the reusable client architecture before adding domain-specific signals.
Implemented as the shared attention composer, provider, empty registry, nav
indicator, and Home summary panel. Domain contributors remain Phase 1 work.

### Deliverables

- Shared frontend attention types, for example:
  - `AttentionSeverity = 'attention' | 'watch'`
  - `AttentionDomain = 'agents' | 'beads' | 'runs' | 'mail' | 'activity' | 'health' | 'maintainer'`
  - `AttentionItem`
  - `AttentionContributor`
  - derived `AttentionSummaryByDomain`
- A city-wide attention composer/provider mounted near `Layout`/`Header`.
- A contributor registry that supports core views and enabled first-party
  modules.
- Nav indicator component with accessible text and themed severity treatment.
- Home replacement/extension that shows top attention items and grouped
  overflow, not a full data dump.
- Ranking rules:
  - `attention` before `watch`
  - actionable, current conditions before historical conditions
  - domain ties stable by current nav order
  - Home shows a small top subset plus grouped overflow
- Tests for:
  - summary derivation from item-level facts
  - nav highest-severity rollup
  - Home top-N/overflow behavior
  - no route disagreement when multiple consumers read the same model
  - `DESIGN.md` One Mark / greyscale expectations for indicators

### Acceptance

- With mocked contributors, Home and nav agree on domain counts and severity.
  **Implemented.**
- Clearing a mocked underlying condition clears the indicator without separate
  acknowledgement state. **Implemented through provider recomposition from
  contributor facts.**
- Multiple attention domains remain readable without violating the page's quiet
  visual hierarchy. **Implemented for the foundation; real-world readability
  should be rechecked as Phase 1 contributors add live facts.**

## Phase 1: Domain Attention Contributors

Add contributors that derive attention/watch from existing data first. Add raw
data endpoints only where the current backend does not expose the facts needed
by the focused route.

### Runs

Use the existing Formula Run health model as the first contributor:

- `attention`: waiting on operator, blocked, failed, stalled/thrashing known
  lane.
- `watch`: unverifiable/inferred run health, stale but not yet stalled.
- Deep links should target `/runs/:runId` with node/scope query when available.

Implementation status:

- Pure contributor support exists for generated supervisor formula feed facts
  plus the transitional RunSummary health model: failed/blocked/waiting feed
  items, detail-unavailable feed items, partial feeds, `needsOperator`,
  blocked lanes, known-thrashing lanes, unverifiable lanes, unavailable health,
  and partial run lists.
- Live Home/nav wiring uses the generated supervisor
  `/v0/city/{cityName}/formulas/feed` path. Focused-route lane highlighting
  is implemented for matching run attention.

### Agents

Contribute from agent/session facts:

- `attention`: pending question / needs-you, crashed/stuck/error state,
  unexpectedly detached, no live session for an expected running agent.
- `watch`: idle/asleep longer than threshold, suspended, degraded provider/rig
  context when available.
- Highlight matching rows in Agents.

Raw data gap to investigate:

- Whether pending interaction state is already available through the current
  supervisor/session endpoints or needs a new typed backend route.

Implementation status:

- Pure contributor support exists for generated supervisor `AgentResponse`
  facts: failed/stuck/crashed, detached, running-without-session, idle/suspended,
  unavailable, partial agent lists, and generated session pending-interaction
  facts.
- Live Home/nav wiring is implemented from generated supervisor agent reads.
  Focused-route row highlighting is implemented for matching agent attention.
  Pending-interaction facts are implemented through generated
  `/v0/city/{cityName}/session/{id}/pending` reads, with an Agents-row
  needs-you badge, copy-attach affordance, and generated supervisor
  `/v0/city/{cityName}/session/{id}/respond` approve/deny controls.
  Idle-stale watch facts are implemented from generated
  `session.last_activity`; threshold constants should be tuned with live use.

### Beads

Contribute from bead status/kanban facts:

- `attention`: blocked, high-priority, stale unclaimed, stale assigned with no
  movement.
- `watch`: ready/unclaimed beyond a softer threshold, convoy tracker artifacts
  only if they appear in the accepted status/kanban workflow.
- Highlight matching cards/rows in Beads.

Do not use this phase to add full bead admin parity.

Implementation status:

- Pure contributor support exists for generated supervisor `Bead` facts:
  blocked, high-priority, partial list, and unavailable list.
- Live Home/nav wiring is implemented from generated supervisor bead reads.
  Board/list highlighting is implemented for matching bead attention.
  Stale unclaimed and stale assigned attention facts are implemented from
  generated bead timestamps; threshold constants should be tuned with live use.

### Mail

Contribute from visible mail data and mailbox history:

- `attention`: unread/recent mail addressed to the operator or otherwise
  requiring response.
- `watch`: unread non-operator mail, partial mail corpus, stale mailbox fetch.
- Highlight matching messages/threads in Mail.

Implementation status:

- Pure contributor support exists for generated supervisor `Message` facts:
  unread operator-addressed mail, unread non-operator mail, partial list, and
  unavailable list.
- Live Home/nav wiring is implemented from generated supervisor mail reads.
  Focused-route row highlighting is implemented for matching mail attention.
  Explicit history-depth expansion is implemented through the generated
  supervisor `limit` query. Thread-level attention treatment is implemented
  inside opened thread modals. Unread stale-mail attention is implemented for
  fetched history; true clock-based history windows remain Phase 2 follow-up
  work.

### Activity

Contribute from current git/deploy data and future supervisor/city events:

- `attention`: failed deploy marker, request failures, crashed/stranded
  sessions, failed orders, event classes that imply operator intervention.
- `watch`: event-stream degradation, unusual but non-actionable event bursts.

Implementation status:

- Pure contributor support exists for dashboard-local deploy facts:
  failed marker, failed deploy records, in-progress deploy records, deploy read
  failures, and event-stream degradation.
- Live Home/nav wiring is implemented from dashboard-local deploy facts.
- Generated supervisor event-history reads are wired for the Activity route
  through `/v0/city/{cityName}/events`. Event-history-derived Activity
  attention facts are wired into Home/nav through the Activity contributor,
  and focused-route row highlighting is implemented for matching supervisor
  events and deploy records.

### Health

Contribute from existing health data:

- `attention`: supervisor unreachable, host memory below threshold, load above
  CPU count by threshold, dashboard process unhealthy.
- `watch`: missing optional supervisor health fields, dolt-noms sampling
  unavailable, service/rig degraded facts if exposed.

Implementation status:

- Pure contributor support exists for dashboard-local `SystemHealth`, generated
  supervisor `HealthOutputBody`, and dolt-noms trend facts: supervisor
  unreachable/non-ok, memory pressure, load pressure, missing optional fields,
  dashboard health read failure, and dolt-noms unavailable.
- Live Home/nav wiring is implemented from dashboard-local host/process health,
  generated supervisor city health, and dolt-noms trend facts. Focused-route
  section highlighting is implemented for matching Supervisor, Host,
  dashboard-process, and Dolt-noms attention/watch facts.

### Maintainer

If enabled, contribute from the maintainer module:

- `attention`: needs-you, needs triage, blocked triage/draft state.
- `watch`: stale cache, partial GitHub data, background refresher degradation.

If disabled, Maintainer contributes nothing and should not appear in nav/Home.

Implementation status:

- Maintainer attention is implemented from dashboard-local `gh` triage facts:
  needs-you items, unvetted items that still need triage, unresolved slung
  work, and in-flight slung work. Disabled Maintainer modules do not fetch
  triage for Home/nav attention.
- Focused-route row highlighting is implemented from the same composed
  Maintainer attention model, so Home/nav and `/maintainer` row treatment use
  one source of truth.

### Acceptance

- Every first-class domain has a contributor or an explicit "no current
  attention facts" module. **Implemented.**
- Home can show city-wide attention from at least Runs, Agents, Beads, Mail,
  Activity, and Health using mocked or fixture data. **Implemented with live
  App/Home wiring and browser validation against mocked supervisor/dashboard
  responses.**
- Focused routes highlight attention items while preserving full route data.
  **Partially implemented and browser-validated for Runs lanes, Agents rows,
  Beads board/list, Mail rows/thread messages, Health sections, and Maintainer
  rows, and Activity event/deploy rows.**

## Phase 2: Mail Workspace Completion

Mail is a first-class domain and should become a complete workspace.

### Supervisor API / Client

Wire the generated supervisor client directly for:

- reply. **Implemented through generated supervisor `replyMail`.**
- archive. **Implemented through generated supervisor mail archive.**
- mark read. **Implemented through generated supervisor mail read-state.**
- mark unread. **Implemented through generated supervisor mail read-state.**
- all-traffic/history reads with time-window defaults. **All-traffic mode is
  implemented as a frontend selector over generated supervisor `Message`
  objects; explicit history-depth expansion is implemented through the
  generated supervisor `limit` query. Clock-based time windows remain a future
  supervisor API gap if operator feedback needs them.**

Keep read and send/write paths logically separated in the frontend. Continue to
support viewing-as for reads and operator-only send semantics. Add upstream
supervisor gaps if any of these mail operations are not exposed or not
browser-safe.

### Frontend

- Add inbox/sent/all-traffic or equivalent mode controls. **Implemented.**
- Add reasonable default time window and explicit expansion/search.
  **Implemented as a default recent-100 generated query with explicit 500/1000
  history-depth expansion plus local search; true clock-based windows are not
  exposed by the current supervisor mail query.**
- Add reply/archive/read-state controls to thread/message views.
  **Implemented for the thread modal.**
- Highlight attention/watch messages without filtering out the rest.
  **Implemented for rows and opened thread messages.**
- Keep compose/send behavior consistent with the existing viewing-as guard.
- Use local success/error feedback near the triggering control. **Basic
  in-flight button labels, disabled states, refresh-on-success, and visible
  error banners are implemented for mail actions.**

### Acceptance

- The operator can read, reply to, archive, and update read-state for eligible
  messages in the visible dataset. **Implemented and browser-validated for
  all-traffic, reply, archive, mark-read, and mark-unread.**
- Attention mail is highlighted and drives Home/nav, but non-attention mail is
  still visible and actionable. **Implemented for the Mail route rows and
  opened thread messages.**
- Write failures are visible; audit semantics are owned by the supervisor for
  supervisor mail mutations. **Implemented for visible failure reporting; the
  writes go through supervisor-generated mutation endpoints.**

## Phase 3: Activity Event Timeline

Activity should answer "what happened?" across both project/dev activity and
Gas City supervisor/city events.

### Supervisor API / Client

- Use generated supervisor event-history reads if available; add an upstream
  gap if the supervisor only exposes event streaming. **Implemented: Activity
  reads `/v0/city/{cityName}/events` through the generated supervisor client
  and same-origin `/gc-supervisor` transport.**
- Preserve same-origin SSE transport behavior for live refresh when standalone
  development needs it. **Implemented for the existing event-refresh consumer
  through `/gc-supervisor/v0/city/{cityName}/events/stream`.**
- Keep attention severity derivation in frontend contributors. **Implemented:
  known actionable supervisor event classes contribute Activity attention/watch
  in Home/nav and are labeled consistently in the Activity table.**

### Frontend

- Add Activity modes/tabs for:
  - commits/deploy log
  - supervisor/city event timeline
  **Implemented.**
- Add event filters for time window, type, actor/source, and severity if useful.
  **Partially implemented: time-window controls, a dedicated generated-query
  type filter, and text filtering across type, actor, subject, and message are
  in place; dedicated actor/severity controls remain optional follow-up.**
- Add event-derived attention contributor logic in the Activity domain.
  **Implemented for known actionable/watch supervisor event classes.**
- Deep-link attention items to filtered event views where possible.
  **Implemented: event-derived attention links to
  `/activity?mode=events&type=...`, and Activity forwards that type filter to
  `/v0/city/{cityName}/events`.**

### Acceptance

- The operator can inspect recent supervisor/city events without using the CLI.
  **Implemented and browser-validated against mocked supervisor event history.**
- Failed deploys and actionable event classes contribute attention/watch items.
  **Implemented and browser-validated for failed deploy facts plus actionable
  supervisor event classes.**
- Activity remains readable and route-based; it does not become a dense legacy
  event wall on Home. **Implemented for the Activity route; Home remains the
  composed attention summary.**

## Phase 4: Agents Intervention Ergonomics

Agents should resolve the "agent needs you" loop far enough that the operator
knows exactly what to do.

### Supervisor API / Client

- Consume pending interaction facts from generated agent/session DTOs when
  available; add an upstream gap if they are missing. **Implemented through
  generated session pending reads.**
- Investigate whether in-dashboard respond can safely use an existing
  supervisor HTTP endpoint. If it cannot meet the security/audit model, keep
  v1 to attach/copy affordances. **Implemented through generated supervisor
  `/v0/city/{cityName}/session/{id}/respond` writes with the dashboard
  mutation header.**

### Frontend

- Highlight agents/sessions with pending questions.
  **Implemented through Home/nav attention and the Agents row needs-you badge.**
- Add copy/open affordance for the appropriate `gc agent attach ...` or
  equivalent command. **Implemented as a copy-attach row action.**
- If safe respond is implemented, add local response controls near the pending
  prompt. **Implemented with Approve/Deny row controls near the pending
  prompt.**
- Add grouping/filtering by rig/state without recreating separate legacy crew,
  rigged, and pooled panels. **State grouping exists; richer rig grouping
  remains follow-up where useful.**

### Acceptance

- An agent question produces Home/nav attention, a highlighted Agents row, and
  a clear route to respond. **Implemented for Home/nav attention, row
  highlighting, attach-command copy, and direct in-dashboard approve/deny.**
- The minimum response path is one click to copy/open the attach command.
  **Implemented and browser-validated; direct approve/deny is also available
  when the pending interaction can be answered through the supervisor respond
  endpoint.**
- No separate command-center panels are added.

## Phase 5: Beads Status and Targeted Dispatch

Beads should remain a status/kanban workspace with one targeted dispatch write.

### Supervisor API / Client

- Use generated supervisor routes to create and sling a new bead to a specific
  rig + agent. Add upstream gaps rather than dashboard-server wrappers if the
  needed write shape is missing. **Implemented: Beads posts
  `/v0/city/{cityName}/beads` and `/v0/city/{cityName}/sling` through the
  generated browser supervisor client with `X-GC-Request`.**
- Validate form input before invoking the supervisor client. **Implemented for
  title and target.**
- Render only the typed result needed by the UI. **Implemented: the route keeps
  the created bead id and sling target for local feedback.**

### Frontend

- Preserve current board/list/detail strengths.
- Add rig filters where bead data supports them. **Implemented through the
  generated supervisor `rig` query on bead reads.**
- Highlight attention/watch beads in board/list.
- Add create-and-sling flow:
  - bead title/body **Implemented.**
  - rig selection **Implemented for the dispatch form.**
  - agent selection **Implemented from supervisor agent reads.**
  - local success/error feedback **Implemented and browser-validated.**
- Keep useful claim/close/nudge behavior. Claim, close, and nudge now use
  generated supervisor writes.

### Acceptance

- The operator can create a new bead and route it to a selected rig + agent.
  **Implemented and browser-validated.**
- Stale/high-priority/blocked bead attention is visible in Home/nav and Beads.
- Full legacy admin operations remain out of scope.

## Phase 6: Health and Cross-Cutting Rig Context

Health remains observational, but abnormal facts should be visible and shared
with attention.

### Deliverables

- Health contributor for supervisor, host, admin process, dolt-noms, and any
  available service/rig health facts. **Implemented for generated supervisor
  health, dashboard-local host/admin health, and dolt-noms trend facts; richer
  service/rig health waits on upstream facts.**
- Shared rig filter primitives or conventions for Agents, Beads, Runs, Mail,
  and Activity where data supports rig grouping. **Implemented where data is
  currently explicit: Agents group/filter by state/project, Beads uses the
  supervisor `rig` query, and remaining domains stay data-shape dependent.**
- No service/rig mutation controls.

### Acceptance

- Health degradation contributes Home/nav attention. **Implemented through the
  Health attention contributor.**
- Rigs/services can contextualize data and filtering without becoming their own
  admin-control domain. **Partially implemented for Beads rig filtering;
  service/rig control surfaces remain out of scope.**

## Phase 7: Local Feedback, QA, and Documentation

### Deliverables

- Local write feedback patterns for mail, bead dispatch, and any agent response
  write.
- Route-level loading/error/partial-data states for every new raw data path.
- Update README/specs if default route, attention semantics, or module behavior
  changes.
- Test coverage scaled to risk:
  - shared/frontend type tests for attention model
  - route/component tests for nav indicators and Home
  - backend route tests for new write/read endpoints
  - focused frontend tests for Mail, Activity, Agents, Beads
  - Playwright/snap coverage only where visual layout or multi-route behavior
    needs browser verification

### Acceptance

- `npm run lint`
- `npm run typecheck`
- `npm --workspace frontend test`
- `npm --workspace backend test`
- Any targeted snapshot/browser harness relevant to touched views

## Open Product Checks

- Initial stale-agent, stale-bead, and stale-mail constants are implemented;
  exact thresholds should still be tuned with fixtures and operator feedback,
  not copied blindly from legacy panels.
- Convoys stay deferred unless the accepted Beads status/kanban workflow cannot
  represent grouped work without them.
- Rich stopped-city guardrails stay deferred unless city switching exposes a
  confusing stopped-city experience.
- Command palette/raw inspectors stay deferred until navigation/debugging pain
  is observed.

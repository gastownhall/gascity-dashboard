# Feature Gap Analysis: Legacy `gc dashboard` to `gascity-dashboard`

Date: 2026-05-31
Status: Combined, source-validated, and product-dispositioned
Implementation plan: [`plans/feature-gap-remediation-plan.md`](plans/feature-gap-remediation-plan.md)

This document has two parts:

1. **Validated feature gaps** - what the built-in `gc dashboard` can do that
   this standalone dashboard cannot currently do.
2. **Principles and decisions** - which gaps we intend to fill, not fill, or
   defer for the standalone dashboard, and why.

Upstream Gas City supervisor API and shared-presentation gaps are tracked
separately in [`gc-supervisor-api-gaps.md`](gc-supervisor-api-gaps.md). This
file is about dashboard product/UI parity and standalone-dashboard decisions.

## Section 1: Validated Feature Gaps

### Purpose

This section identifies features present in the dashboard built into
`~/Code/gastownhall/gascity` that are absent or materially narrower in this
standalone `gascity-dashboard` repo.

The comparison is intentionally asymmetric: it is about what the built-in
`gc dashboard` can do today that the standalone dashboard cannot yet do. This
section does not decide whether each gap should be filled.

### Method

Legacy source reviewed:

- `~/Code/gastownhall/gascity/cmd/gc/cmd_dashboard.go`
- `~/Code/gastownhall/gascity/cmd/gc/dashboard/web/index.html`
- `~/Code/gastownhall/gascity/cmd/gc/dashboard/web/src/api.ts`
- `~/Code/gastownhall/gascity/cmd/gc/dashboard/web/src/main.ts`
- `~/Code/gastownhall/gascity/cmd/gc/dashboard/web/src/palette.ts`
- `~/Code/gastownhall/gascity/cmd/gc/dashboard/web/src/panels/*.ts`
- `~/Code/gastownhall/gascity/cmd/gc/dashboard/web/src/state.ts`

Standalone source reviewed:

- `README.md`, `specs/requirements/product.md`, `DESIGN.md`
- `frontend/src/App.tsx`
- `frontend/src/CityBootstrap.tsx`
- `frontend/src/api/client.ts`
- `frontend/src/routes/*`
- `backend/src/city/runtime.ts`
- `backend/src/routes/*`
- `backend/src/gc-client.ts`
- `shared/src/*`

Validation rules:

- A feature only counts as implemented when there is a user-reachable route,
  panel, control, or backend endpoint in the current source tree.
- Generated supervisor client types alone do not count as standalone dashboard
  functionality.
- Legacy helper files are not counted unless they are mounted by
  `index.html`/`main.ts` or reachable through a panel.
- Product vocabulary follows this repo: Formula, Run, Formula Run. Legacy
  `workflow` naming is treated as supervisor-edge vocabulary only.

### Impact Scale

- **Critical** - Missing from the primary operator loop; forces CLI/API fallback
  for common dispatch or work-management tasks.
- **High** - Blocks a major built-in-dashboard workflow or multi-city/operator
  control surface.
- **Medium** - Removes meaningful efficiency, situational awareness, or
  power-user ergonomics, but has an alternate path.
- **Low** - Convenience, polish, or diagnostics gap.

### Findings Summary

The standalone dashboard is stronger than the built-in dashboard for Formula
Run inspection, maintainer triage, cross-entity context, impersonated mailbox
reading, and the editorial/ambient product direction. The largest legacy gaps
are operational controls and dense operator-console affordances that the
built-in dashboard exposes directly against the supervisor API.

The root cause is architectural. The built-in dashboard calls a broad slice of
`/v0` supervisor endpoints directly from the browser. The standalone dashboard
is being migrated to the same model for GC-owned reads; the remaining custom
dashboard service surface is narrower and focused on dashboard-local writes or
host/GitHub functionality:

- `POST /api/snapshot/refresh`
- `POST /api/maintainer/sling`
- `POST /api/client-errors`

Highest-impact validated gaps before product disposition:

1. Generic bead creation/editing/reopen/assignment/sling.
2. Convoys.
3. Rig, service, escalation, assigned-work, and queue administration.
4. Supervisor/no-city fleet mode and `gc dashboard` launch integration.
5. Mail clock-based window filtering and recipient ergonomics.
6. Activity actor/severity event filters, if text search plus dedicated type
   filtering proves too coarse.

### Gap Matrix

| # | Category | Built-in `gc dashboard` capability | Standalone state | Impact | User impact |
|---|---|---|---|---|---|
| 1 | Launch and packaging | `gc dashboard` and `gc dashboard serve` start the static dashboard, auto-discover the supervisor API when possible, and accept `--api`/`--port`. | Standalone runs as npm workspaces with separate backend/frontend dev servers; it is not yet wired into `gc dashboard` launch or packaging. | **High** | Operators cannot use the existing CLI muscle memory or replacement path yet. |
| 2 | Supervisor/fleet scope | No-city mode shows supervisor-level state, managed city tabs, and disabled city-scoped actions until a city is selected. | Bare `/` redirects to the first known city; most app routes are city-scoped under `/city/:cityName`. | **High** | Multi-city operators lose the fleet overview and safe "no city selected" landing state. |
| 3 | Stopped-city guardrails | City tabs and panels distinguish stopped/error cities and disable city-scoped forms with explicit copy. | No equivalent stopped-city command-center state; failed city data appears through route errors/partial state instead. | **Medium** | Operators get less immediate guidance when a city is stopped or unavailable. |
| 4 | Convoys | Convoy list, detail, creation, progress breakdown, issue add/remove/check/close paths, and convoy status chips. | No convoy route, API client, backend route, or UI module. Existing references are incidental filtering/generated supervisor types, not user functionality. | **High** | Operators cannot coordinate grouped work from the dashboard. |
| 5 | Bead lifecycle | Create bead, close/reopen, set priority/labels, assign/reassign/unassign, sling to target, dependency/ready/blocked views, rig filters. | Bead list/detail/board/dependency graph exist, plus supervisor-query rig filtering, generated-client claim/close/nudge, and targeted create-and-sling to a selected rig + agent through the generated supervisor client. No generic reopen, priority/label edit, generic assign/reassign/unassign, or broader sling/admin surface. | **High** | Operators can filter, create, and dispatch new work from the dashboard, but still fall back to CLI/API for full lifecycle administration. |
| 6 | Escalations, assigned work, queues | Admin panels show escalations, assigned work, and queues with acknowledge/resolve/reassign/unassign/clear controls. | No escalation, assigned-work admin, or queue administration views. | **High** | Urgent or stuck work cannot be triaged from the dashboard. |
| 7 | Rig/service operations | Services panel restarts services; Rigs panel suspend/resume/restart rigs and exposes status/action controls. | No service or rig admin routes/panels/endpoints in the standalone dashboard. | **High** | Operators cannot perform common operational recovery actions from the UI. |
| 8 | Agent/crew operations | Crew, rigged-agent, and pooled-agent panels separate agent populations, show pending interaction signals, provide attach-command copy, and expose log/transcript drawers with older-history loading. | Agents list/detail, session/run inspection, generated pending-interaction reads, Home/nav needs-you attention, copy-attach affordances, and generated supervisor approve/deny responses exist. The crew/rigged/pooled operational split and back-paging drawer ergonomics are not present. | **Medium** | Agent supervision now surfaces and answers pending questions, but the legacy crew split is intentionally not recreated. |
| 9 | Mail operations | Inbox plus all-traffic mode, open-thread/message flows, reply, archive, mark read/unread, compose, and recipient options. | Mail list/thread reading, all-traffic mode, generated-query history-depth expansion, send, reply, archive, and mark read/unread use the generated supervisor client directly. Clock-based history windows and richer recipient options remain open. | **Medium** | Core mail triage is available, and operators can expand the fetched history depth, but clock-window review and recipient ergonomics still lag the built-in dashboard. |
| 10 | Event activity timeline | Supervisor and city event timeline backed by `/v0/events` and `/v0/city/{city}/events`, with filtering and live refresh. | Views refresh from the direct supervisor city event stream, and `/activity` has Project activity plus Supervisor events modes. The event timeline reads `/v0/city/{city}/events` through the generated supervisor client with time-window controls, a generated-query type filter, and text filtering. Actionable event classes contribute Activity attention in Home/nav and deep-link to filtered event views. Dedicated actor/severity controls remain optional. | **Low** | Operators can inspect chronological city events, see event-derived attention, and jump from attention to the matching event class. |
| 11 | Command palette and raw inspectors | Keyboard/open-button command palette can open common forms and inspect raw supervisor/city JSON. | No command palette or raw inspector surface. | **Medium** | Power users lose fast navigation, action discovery, and live debugging shortcuts. |
| 12 | One-screen command center | Built-in dashboard keeps status, crew, activity, mail, beads, admin panels, convoys, and output in one dense page. | Standalone uses route-specific pages: Home, Agents, Beads, Runs, Mail, Activity, Health, Maintainer. | **Medium** | Cross-domain monitoring requires navigation instead of a single command-center scan. |
| 13 | Status banner alerts | Status panel aggregates running agents, assigned/open work, convoy count, unread mail, stuck agents, stale assignments, high-priority issues, dead sessions, and partial API failure. | Standalone has health/concern surfaces but not the same always-visible operational alert banner. | **Medium** | Operators lose at-a-glance warnings for several urgent conditions. |
| 14 | Live connection/write feedback/output | Built-in UI exposes connection state, write toasts, and an output panel for command/action results. | Live indicators exist only in specific SSE-backed views; no global connection badge, global action toast system, or output panel equivalent. | **Low/Medium** | Reduced confidence after writes and fewer immediate diagnostics. |

### Gap Details

**Launch, scope, and fleet**

The legacy dashboard is part of the `gc` CLI and supports no-city supervisor
scope, managed city tabs, stopped/error city handling, and city-scoped action
gates. The standalone dashboard is run as its own Node/React app and centers
one active city, with a city switcher for managed cities.

**Work coordination: Beads and Convoys**

The legacy dashboard exposes the full work-item lifecycle: create, close,
reopen, priority/label edit, assign/reassign/unassign, sling, ready/blocked
views, rig filters, and dedicated convoy list/detail/create/add controls. The
standalone dashboard has stronger read-side Beads visibility, but a narrower
write surface: generated-client claim/close/nudge and generated-client targeted
create-and-sling.

**Operational control: Agents, Rigs, and Services**

The legacy dashboard separates crew, rigged agents, and pooled agents; surfaces
pending interaction signals; provides attach-command copy; exposes transcript
drawers; and includes service/rig controls. The standalone dashboard has Agents
list/detail, Peek/live run context, Formula Run drilldown, generated pending
interaction reads, needs-you attention, and copy-attach actions, but not the
same crew split, in-dashboard response controls, transcript back-paging, or
service/rig admin surface.

**Mail**

The legacy mail panel supports inbox, all-traffic, thread/message opening,
reply, archive, read/unread, compose, and recipient options. The standalone
Mail view supports direct-supervisor mailbox/thread reading, all-traffic mode,
operator send, reply, archive, mark read/unread, read-only impersonation, and
attention highlighting in both mailbox rows and opened thread messages.
Clock-based history windows and richer recipient options remain open; explicit
generated-query history depth is implemented.

**Events and observability**

The legacy Activity panel exposes supervisor and city event history. The
standalone frontend consumes supervisor city event streams for reactive
refresh through the generated supervisor transport path, and the Activity route
now has a supervisor/city event timeline beside git/deploy activity. Event
attention deep-links into `/activity?mode=events&type=...`, and Activity sends
that type filter through the generated supervisor query. Dedicated
actor/severity filters remain optional if plain text filtering proves too
coarse.

**Power-user and feedback affordances**

The legacy dashboard has a command palette, raw JSON inspectors, dense one-page
panel layout, global status banner, global connection state, write toasts, and
an output panel. The standalone dashboard is route-based and localizes loading,
error, and stream states.

### Validation Notes and Corrections

- The legacy `ready.ts` helper was not treated as a standalone mounted panel.
  Ready/blocked capability is counted only where it is user-reachable through
  the bead work surfaces.
- The standalone repo contains generated supervisor client functions for many
  legacy endpoints, including convoys. Generated functions are not counted as
  implemented dashboard features until routed through the frontend UI.
- Standalone `POST /api/maintainer/sling` is maintainer-specific. It does not
  close the gap for generic bead/admin sling workflows.
- Standalone `/activity` includes git/deploy activity and a generated-client
  supervisor/city event timeline. Event-derived Home/nav attention is
  implemented for known actionable/watch event classes, and those items
  deep-link to the matching generated-query event type filter.

## Section 2: Principles and Decisions

### Decision Principles

The validated gaps do not imply broad legacy parity. The standalone dashboard
remains a calm, single-operator, route-based tool.

1. **Home summarizes abnormal state.** Home should notify the operator of
   abnormal city state at a glance.
2. **Tabs show their own attention.** Nav tabs should show themed
   attention/watch indicators when their domain has items needing operator
   attention.
3. **Attention controls prominence, not visibility.** Focused tabs show full
   relevant datasets with reasonable time-window defaults; attention items are
   highlighted, sorted, grouped, or badged but not used as the only visible
   data.
4. **The client owns attention.** Domain contributors gather raw, typed data
   into a coherent client-side attention model. The backend serves raw,
   normalized DTOs and audited write endpoints; it should not encode product
   judgment such as "this needs operator attention."
5. **Focused tabs are domain workspaces.** Mail, Agents, Beads, Runs, Activity,
   Health, and enabled Maintainer routes should be complete enough for their
   accepted domain responsibilities.
6. **Writes are targeted and local.** Add writes only where they serve accepted
   domain workflows. Keep write feedback near the action. Every write stays
   backend-mediated, typed, CSRF/origin protected, and audited.
7. **Do not recreate the command center.** Dense legacy panel parity, global
   output consoles, service/rig mutation panels, and broad admin-console
   surfaces conflict with the standalone product direction unless a later
   workflow proves the need.
8. **Standalone scope is not fold-back scope.** `gc dashboard` command
   integration is real replacement work, but not part of the current standalone
   gap-remediation pass.

### Domain Model

The accepted standalone domains are:

- **Home** - city-wide attention summary, not a data domain.
- **Agents** - all agent/session state, pending questions, attach/respond
  affordances, rig grouping/filtering.
- **Beads** - status/kanban, existing useful actions, and targeted
  create-and-sling to rig + agent.
- **Runs** - Formula Run visibility, investigation, and attention highlighting.
- **Mail** - complete mailbox workspace, including reply/archive/read-state.
- **Activity** - project/dev activity plus supervisor/city event timeline.
- **Health** - supervisor, host, dashboard process, and available service/rig
  health facts.
- **Maintainer** - optional module; contributes only when enabled.

Rigs/services are cross-cutting filters/context and health facts, not standalone
mutation domains. Convoys conceptually belong under Beads but are deferred
unless the accepted Beads status/kanban workflow needs them.

### Disposition Matrix

| Gap # | Category | Disposition | Why |
|---|---|---|---|
| 1 | Launch and packaging | **Defer** | Fold-back into `gc dashboard` comes later; current work is standalone behavior. |
| 2 | Supervisor/fleet scope | **Do not fill now** | City switcher is enough for standalone scope; no legacy fleet/no-city command center. |
| 3 | Stopped-city guardrails | **Defer** | Improve only if current city switching makes stopped cities confusing. |
| 4 | Convoys | **Defer / trim** | Convoys belong under Beads conceptually, but no dedicated convoy workspace now. |
| 5 | Bead lifecycle | **Fill trimmed scope** | Keep status/kanban and existing useful actions; add create-and-sling to rig + agent. |
| 6 | Escalations, assigned work, queues | **Do not fill now** | Legacy admin-console surfaces, not accepted standalone domains. |
| 7 | Rig/service operations | **Do not fill now** | Show rig/service facts as filters/context/health; no restart/suspend/resume controls. |
| 8 | Agent/crew operations | **Fill partial** | Add pending-question visibility and attach/respond affordances inside Agents. |
| 9 | Mail operations | **Fill** | Mail is a first-class complete workspace; attention highlights but does not filter. |
| 10 | Event activity timeline | **Fill** | Activity should include supervisor/city event history beside git/deploy activity. |
| 11 | Command palette/raw inspectors | **Defer** | Useful power-user affordance, but not required for accepted attention/workspace model. |
| 12 | One-screen command center | **Do not fill** | Explicitly rejected by product/design direction. |
| 13 | Status banner alerts | **Fill as attention model** | Replace legacy banner parity with client-owned Home/nav attention model. |
| 14 | Connection/write/output affordances | **Fill local feedback only** | Keep action results near the control; no global output panel/action log now. |

### Fill Decisions by Domain

**Home and navigation**

- Build a client-owned city-wide attention model.
- Add themed attention/watch nav indicators.
- Show top attention items on Home with grouped overflow.

**Agents**

- Surface pending questions / needs-you state.
- Highlight abnormal agent states.
- Add copy/open attach affordance.
- Add in-dashboard respond through the supervisor endpoint. **Implemented for
  approve/deny pending interactions.**
- Use grouping/filtering inside Agents instead of legacy crew/rigged/pooled
  panels.

**Beads**

- Keep status/kanban as the core workspace.
- Preserve useful claim/close/nudge behavior on the generated supervisor
  client.
- Add create-and-sling a new bead to a specific rig + agent. **Implemented
  through generated supervisor `create bead` and `sling` writes.**
- Add rig filters where data supports them.
- Do not add full generic bead admin parity now.

**Runs**

- Keep Formula Run visibility/investigation as the core purpose.
- Add attention highlighting for stalled, failing, blocked, and
  waiting-on-operator runs.
- Do not add run/order mutation controls now.

**Mail**

- Keep generated-query history-depth expansion.
- Add clock-based history windows only if the supervisor API grows that query.
- Refine recipient options.
- Preserve current viewing-as model.
- Highlight outstanding mail, but keep full selected-history mail visible and
  actionable.

**Activity**

- Keep current commits/deploy log.
- Add dedicated actor/severity event filters only if text search plus the
  generated-query type filter proves too coarse.

**Health**

- Highlight degraded supervisor, host, dashboard process, and available
  service/rig health facts.
- Do not add service/rig mutation controls.

**Maintainer**

- If enabled, contribute attention/watch items.
- If disabled, contribute no nav, route, worker, or attention data.

### Do-Not-Fill / Defer Summary

Do not fill now:

- Legacy one-screen command center.
- Legacy supervisor/fleet/no-city mode.
- Full bead admin suite.
- Escalations, queues, and assigned-work admin.
- Service/rig restart/suspend/resume controls.
- Run/order mutation controls.
- Global output panel or global action log.

Defer:

- `gc dashboard` launch/packaging integration.
- Rich stopped-city guardrails.
- Dedicated convoy workspace.
- Command palette.
- Raw JSON inspectors.

### Implementation Sequencing

Detailed execution plan: [`plans/feature-gap-remediation-plan.md`](plans/feature-gap-remediation-plan.md).

1. Build the client attention foundation.
2. Wire domain attention contributors.
3. Complete remaining Mail history/recipient ergonomics.
4. Add Activity filtered event deep links if needed.
5. Improve Agents intervention ergonomics.
6. Trim Beads work to accepted status/kanban plus create-and-sling scope.
7. Tighten Health highlighting and local write feedback.

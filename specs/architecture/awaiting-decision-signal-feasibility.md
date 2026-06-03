# Spike finding: "agent awaiting human decision" signal

Historical exit artifact for the awaiting-decision feasibility spike in
`prd_incorporate-tmai-amux-components.md`. Verified against committed repo
artifacts on 2026-06-01 and superseded by the Agents pending-interaction
implementation tracked in `specs/plans/feature-gap-remediation-plan.md`.

## Verdict

**EXISTS in the supervisor API — as BOTH a REST snapshot field AND an SSE event — and the dashboard now consumes the REST form on the Agents surface.** The signal is the supervisor's **`PendingInteraction`** (tool-approval / prompt-for-input). No upstream change is required for the per-session case.

## Evidence (all in `backend/openapi/gc-supervisor.openapi.json` unless noted)

- **Wire shape** — `PendingInteraction` (:4607): `{ request_id (req), kind (req), prompt?, options?: string[]|null, metadata? }`.
- **REST snapshot** — `GET /v0/city/{cityName}/session/{id}/pending` (:23301) → `SessionPendingResponse` (:6016): `{ supported: bool, pending?: PendingInteraction }`.
- **Write-back** — `POST /v0/city/{cityName}/session/{id}/respond` (:23574) ← `SessionRespondInputBody`: `{ action (req), request_id?, text?, metadata? }`. This is the real target for the decision-gate's accept/decline POST.
- **SSE event** — the per-session stream `GET .../session/{id}/stream` (:23730) emits a `{ event: "pending", data: PendingInteraction }` variant (:23856).
- **Not a session state** — `SessionResponse.state` is a free-form string with no enum (:6197); session activity is only `idle`/`in-turn`. Awaiting-decision is a separate `pending` channel, not a state value.
- **Not on the city-wide stream** — `TypedEventStreamEnvelope` (:7298) lists ~50 city event types (`bead.*`, `session.crashed/idle_killed/...`); none is `pending`/`awaiting`/`decision`.

## Current dashboard consumption

- `frontend/src/supervisor/agentPending.ts` reads
  `GET /v0/city/{cityName}/session/{id}/pending` through the generated
  browser supervisor client and writes decisions with
  `POST /v0/city/{cityName}/session/{id}/respond`.
- `frontend/src/routes/Agents.tsx` renders the pending prompt, copy-attach
  affordance, and Approve/Deny controls. `frontend/src/attention/liveContributors.ts`
  contributes those pending facts to Home/nav attention.
- The city stream is now consumed directly from
  `/gc-supervisor/v0/city/{cityName}/events/stream`. It still does not carry
  `pending`, so city-stream consumers remain refresh/invalidation only.
- `frontend/src/hooks/useSessionStream.ts` remains transcript-focused and does
  not consume `pending` SSE frames; Agents uses the generated REST pending path
  instead.
- The `blocked` values in `shared/src/gc-beads.ts` (BeadStatus) and `shared/src/run-detail.ts` (RunNodeStatus) are **work-graph** blocked (dependency), unrelated to awaiting-human-input.

## Path to surface it

1. **Dashboard-owned, no upstream issue (basic case):** implemented via
   generated `GET .../session/{id}/pending` reads and
   `POST .../respond` writes. A future transcript-panel enhancement could also
   consume the session SSE `pending` variant, but it is not required for the
   Agents response workflow.
2. **Optional upstream `gc` ask (city-wide case only):** to flag *which* agents across the city are blocked on a human without opening one SSE per session, the supervisor would need to emit a city-stream event (e.g. `session.pending` carrying `{session_id, request_id, kind}`) in `TypedEventStreamEnvelope`. That — and only that — is a legitimate `gastownhall/gascity` request.

## RFC-target adjudication (corrects the premortem)

The premortem's "RFC drafts target demo-dash" claim is **TRUE** for all four `.claude/rfc-drafts/` files (each is `gh issue create --repo gastownhall/demo-dash`). But its implication that those RFCs cover the decision signal is **FALSE** — they concern aimux **vendor quota** (rfc-1), tokscale **token windows** (rfc-2), and two dashboard-alignment discussions (rfc-3, rfc-4). **None addresses awaiting-human-decision.** This signal needs no demo-dash change and (per above) no `gc` change for the per-session case.

# gas-city-dashboard-tui (prototype)

A terminal glance surface for the Gas City dashboard — the smallest viable
prototype to prove or kill the idea of a TUI an operator leaves open in a tmux
split instead of alt-tabbing to the SSH-forwarded browser tab.

## What it is (and is not)

- **Thin client of the backend `/api/*`.** It reuses the `shared` DTOs directly
  (`gas-city-dashboard-shared`), so a contract drift is a compile error here,
  not a runtime `undefined`. It talks only to the backend — never to the gc
  supervisor — so it inherits edge translation, sanitisation, timeouts, CSRF and
  audit for free (`backend/src/gc-client.ts` is the only supervisor seam).
- **Read-only.** No writes (claim/close/sling/respond) — those need the CSRF
  double-submit the web client does; out of scope for the prototype.
- **No tmux pane-attach.** Deliberately rejected: raw `capture-pane` bytes would
  bypass the server-side ANSI/OSC sanitisation that is the load-bearing XSS
  defence, and break the 127.0.0.1-only posture. Session content reaches the
  operator through the backend, not by attaching to panes.

## Views (full-screen toggles)

Each is a full-screen toggle over the same navigable area; the selection
persists across the live refresh. `enter` drills the selected row into a single
reused tmux split (see Peek).

- **Overview** (`o`): the calm mayor-companion view — one scrollable, peekable list
  with attention-first sections, **LEDGER** (what's waiting on you: needs-operator
  runs then mayor-escalated mail, worker chatter folded away with the folded count
  shown, the single red heading) → **ACTIVE** (live agents, orchestration
  first) → **BEADS** (in-progress) → **RUNS** (summary). `↑`/`↓`/wheel scroll the
  whole list; `enter` peeks the selected row whatever it is — a run (`bd show` +
  diff), a **mail** (`gc mail peek`, read-only, doesn't mark read), an agent (live
  log), or a bead; `enter` again or `x` closes the peek; `p` opens an agent's
  detail. ACTIVE rows show `on <run>` when the agent is in a run lane's
  `activeAssignees`, else the activity hint; city-level agents read as the city
  name, not `orchestration`. This is the default view when the panel is launched
  beside another session (`--split` / `--target`, which pass `--compact`); `o`
  toggles to the full dashboard and back. Greyscale, one red region (DESIGN.md
  Reading Room / One Mark).
- **Agents** (default standalone): grouped by rig (orchestration layer first; within a rig,
  active before idle), one line each as `glyph · agent · kind · ctx% · activity ·
  model · last-active`. A leading glyph + short word carries the agent kind so it
  reads in greyscale (no color-as-signal, per `DESIGN.md`): `△ orch` (mayor,
  control-dispatcher), `◆ role` (named agents: project-lead, reviewer, …), `· pool`
  (polecat workers). Dormant agents show their transition reason (e.g. `city-stop`).
  `a` cycles the status filter (active+idle → active → idle) so idle noise can be
  hidden; failed agents always show regardless of the filter. Greyscale-first, one
  red mark for what's worth a glance.
- **Beads** (`b`): grouped by status (open → in_progress → blocked → closed),
  priority-ordered. `enter` opens `gc bd show <id>` in the split — the bead's
  instructions/description/labels.
- **Formula runs** (`f`): run lanes grouped by rig, needs-operator first (one red
  mark). `enter` opens the run's bead (`gc bd show`) plus its code diff in the
  split.
- **Sessions** (`s`): a flat "live now" feed of the active sessions, most-recently
  active first, each with a mechanical phrase for what it's doing right now (the
  supervisor's coarse activity hint, e.g. `running a tool` / `thinking`). This is
  the honest non-LLM signal — no per-session transcript is exposed as data, so a
  model-written task summary is a deliberately deferred follow-up, not faked here.
  `enter` peeks the session log; `p` opens its detail like the Agents view.
- **Ledger** (`l`): an "open ledger" of things waiting on the operator — mail
  escalated by the orchestration layer (the mayor) and run lanes flagged
  needs-operator. The inbox is a firehose of worker status reports the mayor
  digests, and the wire's `read`/`priority` flags are unusable as a "needs you"
  signal (priority is never set; mail is never marked read), so the ledger filters
  by **sender role** — it shows mail from the mayor / orchestration agents and
  folds the pool-worker chatter away (reporting the folded count, never silently).
  Read-only summary (the TUI does no writes); each section shows a `+ N more` line
  rather than capping a long backlog.
- **Health** (`h`): host resources, headline counts, runs needing an operator,
  context-pressure agents (≥75%), and a never-active-by-rig reallocation rollup.
  Costs are shown as *not measured* (the supervisor exposes none yet — see
  `specs/architecture/cost-token-feasibility.md`); never faked.
- **City board** (`m`): a compact whole-city matrix — rigs as rows, in-flight run
  phases as columns (`ready · impl · review · ok'd · PR · block · active`), tabular
  greyscale counts in cells, with a `needs` column carrying the single red mark when a
  rig has lanes flagged needs-operator. Rows order attention-first (needs-operator rigs,
  then busiest). Inspired by the gc tmux console's per-repo status grid, translated into
  the TUI register (greyscale counts, one red mark, no color-as-signal). **History is not
  shown:** completed lanes are capped in the snapshot DTO, so a `done`/total column would
  read a confident wrong number — the board is in-flight only, never faked (see
  `specs/architecture/tui-tmux-dashboard-gap-analysis.md`).
- **Detail** (`p`, agents only): in-TUI detail for the selected agent — ids, the
  peek commands, that rig's beads and active run lanes. `c` toggles a **config**
  tab showing the agent's fetchable session config (template, pool, kind, model,
  provider, session name, alias, context window, …). The launch prompt is shown as
  `not exposed by supervisor API` — the session HTTP surface carries config but not
  the prompt text, and the prototype never fakes a value it can't read.

## Peek (tmux split)

`enter` on a row opens **one reused** tmux split **below** the dashboard and points
it at the selected row's drill-in (agent → live `session logs -f`; bead →
`bd show`; run → `bd show` + diff; mail → `gc mail peek`). Splitting below (not to
the right) keeps the dashboard's full width, which matters when it's pinned narrow
beside the mayor. `enter` retargets that pane to a new
selection (no pile-up); `enter` on the row it's already showing, or `x`, closes
it. Quitting (`q`) tears the peek pane down. All drill-ins READ (logs/show/diff)
— none attaches as a tmux client, so peeking can't resize or disturb an agent.

## Controls

`↑`/`↓` or `j`/`k` move the selection · **mouse wheel** scrolls · `PageUp`/`PageDown`
· `g`/`G` top/bottom · `enter` drill into split · `x` close split · `a` cycle agent
status filter · `b` beads · `f` runs · `s` sessions · `l` ledger · `h` health · `m` city
board · `p` agent detail · `c` toggle config tab (in detail) · `q` (or `esc`) quit.

## Run

The backend must be running (`npm run dev:backend`) against a live supervisor.

```bash
# from repo root, after `npm install`
set -a; . ./.env.local; set +a   # defines GC_CITY_NAME
npm --workspace tui run start     # or: npm --workspace tui run start -- --city=<name>
```

### Launch inside tmux (so `enter`-peek works)

The live-peek split (`enter`) needs the TUI to be running inside tmux. If you're
already in a tmux session, the command above is enough. From a plain terminal,
use the launcher, which creates/attaches a dedicated `gc-tui` session:

```bash
npm --workspace tui run start:tmux -- <city>     # or ./tui/start-tmux.sh <city>
```

### Pin it beside another session (the mayor)

To leave the dashboard glancing on the *side* of the session you're working in
(the way an operator keeps it next to the mayor) rather than taking over the
pane, run the launcher with `--split` **from inside the tmux window you want to
split**. It adds a right-hand pane running the TUI and leaves your original pane
in place:

```bash
./tui/start-tmux.sh --split <city>            # 40% wide by default
./tui/start-tmux.sh --split --pct 30 <city>   # narrower side panel
# or: npm --workspace tui run start:tmux -- --split <city>
```

**Mouse vs drag-resize.** The full dashboard grabs the mouse for wheel scrolling.
Pinned companion panels (`--split` / `--target`) default to `--no-mouse` so tmux
keeps the mouse and you can **drag the pane border to resize** the panel (scroll
the lists with the keyboard: `↑↓` / `PgUp` / `PgDn` / `g` / `G`). Force either way
with `--mouse` / `--no-mouse`.

`--split` needs an existing tmux window to split into; run outside tmux it falls
back to the dedicated `gc-tui` session (with a note). Without `--split` the
default is unchanged: take over the current pane when already in tmux, else a
dedicated `gc-tui` session. Press `m` once it's up for the city board.

**One-shot, from anywhere — `--target`.** You don't have to attach and hand-split.
gc runs each city's tmux on a socket named after the city, so the launcher can
split a named session directly:

```bash
./tui/start-tmux.sh --target mayor <city>            # pin beside the mayor
./tui/start-tmux.sh --target mayor --pct 30 <city>   # narrower
```

This splits `tmux -L <city> -t <session>` (override the socket with
`--socket <name>`), adding the dashboard to the right of that session's window
and leaving it in place. Then `gc session attach mayor` shows the mayor and the
dashboard side by side. If the session or socket isn't found, it lists what's on
the socket and exits non-zero rather than guessing.

Env: `DASHBOARD_URL` (default `http://127.0.0.1:8081`), `GC_CITY_NAME` or
`--city=<name>` (required — no silent fallback to a default city). Press `q` to
quit.

## Status

Prototype, not yet wired into root CI `typecheck`. If it graduates, add
`npm --workspace tui run typecheck` to the root `typecheck:src` chain so
shared-DTO changes can't silently break this third consumer.

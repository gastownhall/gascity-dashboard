# Reef info-viz round — plan

Design round refocusing the `/reef` aquarium as an information display, not just
a scene. Grill-driven (2026-07-15). The aquarium is an ambient Jira/agent-work
monitor; its job is to answer three questions at a glance, in this priority
order:

1. **Needs help** — what is stuck / who needs a human. _(loudest, alarm layer)_
2. **Active projects, by what** — which rigs are being worked, by which agents. _(ambient base)_
3. **What work** — the specific beads and their structure. _(on-demand / zoom)_

The root failure this round fixes: the reef tried to make all three equally loud
and collapsed into "coloured dust." An overview has a finite salience budget, so
each goal is assigned a distinct attention layer and a distinct, non-competing
visual channel.

## Channel assignment (the spine of the round)

Each variable gets a _primary_ channel that is unambiguous at overview. Two
channels are deliberately shared along **disjoint axes** (vertical position;
motion) and two variables carry deliberate reinforcement — this is intentional
redundancy for legibility, not the naive "one channel per variable" claim (see
Channel precision below).

| Variable           | Channel                                                          | Notes                                                                                                                                                                                           |
| ------------------ | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rig identity       | **hue** (only)                                                   | Pure identity. Never means status.                                                                                                                                                              |
| Bead status        | **position / behavior**                                          | drift = open, held-at-mouth = in progress, sunken = blocked, surfaced = stranded alarm.                                                                                                         |
| Bead priority      | **size (authoritative) + within-hue luminosity (reinforcement)** | Size is the fog-invariant primary; a distant pellet is dimmed by depth haze, so luminosity/soft same-hue bloom only _reinforces_ size and never carries priority alone. No foreign white pixel. |
| Bead age           | **drift height**                                                 | unchanged (fresh high, stale sinks). Overview only.                                                                                                                                             |
| Agent identity/rig | **fish in a rig school**                                         | unchanged.                                                                                                                                                                                      |
| Agent state        | **pose + motion**                                                | working circulates, idle drifts, asleep rests low; distressed rises (alarm).                                                                                                                    |
| "Needs help"       | **surface shelf (vertical rise)**                                | the loudest, motion-cued, color-free alarm.                                                                                                                                                     |
| Epic structure     | **on-focus clustering**                                          | reveals at LOD1+, like dep links.                                                                                                                                                               |

The two big wins: (a) status moves off color entirely onto position the sim
already produces, so hue is pure identity and the open-vs-in-progress "both
yellow" collapse is gone; (b) "needs help" gets its own loud layer instead of
being a slightly-darker pellet.

### Channel precision (verified against sim/constants.ts, 2026-07-15)

"One variable, one channel" holds strictly for hue (rig) and size+luminosity
(priority). **Vertical position is deliberately a _nested_ channel, not a
strictly-orthogonal one** — and that is fine because its uses are disjoint bands,
not competing overlays:

- Coarse vertical **band** is set by state/status: surface = needs-help,
  mid-water drift zone = open, fish mouths = in-progress, seabed = blocked.
- **Age** refines position _only within the open-drift zone_, nowhere else.

Evidence this does not collide: the drift zone runs `PELLET_FRESH_Y` (0.28 span,
y≈618) → `PELLET_STALE_Y` (0.72 span, y≈1402); the alarm surface band is
waterline..~210. Fresh open work floats to y≈618, well below the shelf, and is a
pellet mark, not a fish/marker — so "fresh open bead" is never confused with a
surfaced alarm. The spec claims nested stratification here, not orthogonality.

**Motion is the same kind of shared channel** (three disjoint axes, not a
collision): horizontal school circulation = rig activity (E); the vertical rise
to the shelf = needs-help alarm (D); fine per-pose body motion (tremor, gape,
belly-flip) = agent state. Different axes and scales, read distinctly. And two
variables are _deliberately_ redundant — priority (size + luminosity) and
needs-help (rise + reason silhouette + tag). Redundancy here buys legibility at
overview; it is called out as intentional, not an accident of the model.

### Surface-shelf ↔ existing bands reconciliation

The shelf (decisions 3–4) is not a new empty band; it **subsumes and extends the
existing surface bands**. Today only `awaiting-input` (`BAND_AWAITING_Y`≈148) and
`errored` (`BAND_ERRORED_Y`≈210) sit at the surface; `stalled`
(`BAND_STALLED_Y`≈654) and `rate-limited` live mid-column. Workstream D **pulls
stalled + rate-limited up to the surface shelf**, vacating their mid bands, so
all four `AgentNeedsYouReason` poses share one scan line. Consequences D must
handle: (i) x-collision / stacking when many entities surface above the same rig
(fan out along the band, keep x≈rig); (ii) the vacated mid bands must not leave a
visible "hole" in a school — the remaining working/idle fish already fill the
mid-water. Reduced-motion: surfaced entities hold as a truthful still frame.

**Which-reason must survive the merge (Codex finding 4):** collapsing four poses
onto one shelf must not flatten "stalled ≠ errored" into an unreadable micro-tag.
The reason is carried at overview by the **existing per-pose fish silhouette**
(errored = belly-up, awaiting-input = nose-up gape, stalled = nose-up tremor,
rate-limited = tucked/clamped) — those shapes already pass the Greyscale Test and
read at distance; the typographic reason tag is _zoom-detail reinforcement_, not
the primary carrier. Optionally, stable micro-lanes within the shelf (one shallow
sub-row per reason) reinforce it. Stranded-work markers get their own distinct
non-fish silhouette so they never read as a distressed agent.

## Decisions (grill, 2026-07-15)

1. **Goal hierarchy:** help = alarm (loudest), projects = ambient base, work =
   on-demand. Drives every channel choice below.
2. **"Needs help" = two things:** (a) an agent needing a human
   (`awaiting-input | errored | stalled | rate-limited` — the shared
   `AgentNeedsYouReason`), and (b) **stranded work**. NOT every blocked bead (a
   bead blocked only by an open dependency will self-resolve), NOT a coarse
   rig-level alarm.

   **Stranded-work predicate (refined per Codex review — rig-level "any live
   agent" is too crude):** key on the bead's own ownership + actionability, not
   whether the rig happens to have _someone_ alive (that someone may be idle or
   on unrelated work, and a rig with zero agents can still have work nobody
   should touch yet). A bead is stranded when it is **actionable** — its
   dependencies are all closed (a bead still waiting on an open dep is _waiting_,
   not stranded) — AND _either_ (i) it is **assigned** but its assigned agent is
   dead/gone (orphaned work), _or_ (ii) it is **unassigned + aging** and the rig
   has no idle capacity to pick it up. So the signal is "actionable work with no
   live owner and no one free," not "blocked bead on a quiet rig."

3. **Alarm visual = surface attention shelf.** Every needs-help entity rises to
   the waterline and holds; the top band is the one strip a human scans for
   "what needs me." Countable (N at the surface), locatable (x ≈ which rig),
   motion-cued (rising reads at any zoom), spends position not color. Generalizes
   the existing awaiting-input rise (today only that one pose rises). Each
   surfaced entity flies a small typographic reason tag ("awaiting input",
   "errored", "stranded"), not an icon.
4. **Who rises:** the **fish itself** rises for distressed agents (errored =
   belly-up floating, etc.), kept tethered to its rig anchor so "which rig"
   survives. **Stranded work** does _not_ raise its pellet (a sinking pellet
   already means blocked); it floats a separate typographic surface marker above
   the rig's column.
5. **Status channel = position/behavior only.** hue = rig identity, period.
   Keep only behavioral reinforcement that is not a color claim (sunken stays
   squashed + contact shadow, held sits at a mouth). Legend teaches vertical
   zones, not status colors.
6. **Priority = size + within-hue luminosity + soft same-hue bloom** for the top
   tier. Drop the binary white specular glint. Size ramp
   (`radiusScaleForPriority`) stays; luminosity reinforces it inside the rig hue.
7. **Labels:** id → title everywhere a human sees it. **Held (in-progress)
   beads carry their short title at LOD1+** (few, and exactly "what's being
   worked on"); drifting/sunken beads show title only on hover/focus. Overview
   stays unlabelled. The raw id is demoted to small secondary text in the card.
8. **Within-rig grouping keys on epic (`parent`).** Parentless beads stay in the
   general drift. (`issue_type` gets no ambient channel — card/tooltip only.)
9. **Grouping reveals on rig-focus (LOD1+)**, overview keeps the calm age-drift
   column. Reuses the focus-reveal pattern (dep links are already focus-only) and
   avoids fighting the age gradient at the scale where age matters.
10. **Legend rig roster = active-first, expandable.** Rigs with live agents show
    first (sorted by activity) with hue + open-bead count; quiet rigs collapse
    under a clickable "+N quiet" that expands the full scrollable roster ("+N
    more" becomes a real expand). Optional: a tiny alarm tick next to any rig
    currently flying a surface alarm. The bead "shade" legend is replaced by the
    **zone key** (surface = needs help, mid = open, held = in progress, seabed =
    blocked) plus a size+glow priority note.
11. **Active vs dormant rig = motion + liveliness.** Working fish circulate and
    feed (busy school); idle drift slowly; asleep rest low and still. A
    fully-dormant rig's school dims slightly so the eye skips it. Alarm motion is
    vertical (rising); school motion is horizontal (circulating) — distinct.

## Goal-#1 "by whom" gap (Codex finding 5)

Goal #1 is "active projects, **by what**." The reef reads rig (school) + agent
type/state (fish) at overview, but **agent identity** (which named agent) only
appears on hover today, so "by whom" is under-served at a glance. Remedies,
cheapest first, to fold into B/C rather than a new ambient channel: (i) at LOD1+,
label the working fish / its held-bead tether with the agent name (pairs the
"what work" title from B with "who"); (ii) the legend's active-first roster (C)
can list **active agents** under each active rig, so the key answers "who is on
what" without touching the tank. Full ambient per-fish naming stays rejected — it
re-creates coloured-dust as text.

## DESIGN §7 amendment (part of workstream A)

§7 is the binding visual contract and several statements there now change. The
workstream-A commit must amend it:

- **Remove** "shade = bead status" from the four-channel list. New pellet
  channel table: **hue = rig, position/behavior = status, size + luminosity =
  priority, drift height = age.** (Fish channels unchanged: size/shape = agent
  type, pose = agent state.)
- **Remove** "Bead status reads as three shades of the rig hue — open (mid), in
  progress (bright), blocked (dark)…" Replace with: status reads as _where the
  pellet lives_ — drifting (open), held at a mouth (in progress), sunken
  (blocked), surfaced (stranded). The fish↔held-bead hairline tether stays.
- **Remove** the P0 specular-glint paragraph. Replace: priority reads as size +
  within-hue luminosity, with a soft same-hue bloom on the top tier; no foreign
  catchlight.
- **Pane Rule:** the key is the rig roster **plus the bead zone key** (replaces
  "bead-status shade legend").

Deferred to the workstream that builds them (DESIGN documents shipped behaviour,
not planned): the **surface attention shelf** paragraph lands with **D**; **epic
grouping on focus** with **F**; **held-bead title labels** (honest-zoom detail)
with **B**.

## Workstreams & sequencing

A → B → C first (they kill the named annoyances and A is the coherence
prerequisite), then D, then E/F. Each ships TDD in the same commit; branch-ready
/ HALT (publish is mayor-gated).

- **A — Encoding cleanup + DESIGN §7.** hue = identity only; drop status-from-
  lightness and the white glint; priority = size + luminosity + top-tier bloom;
  legend status-key → zone key; amend DESIGN §7. _Foundational._
  Files: `render/pellets.ts`, `page/AquariumLegend.tsx`, `AquariumPage.tsx`
  (statusColors → zone key), `DESIGN.md`.
- **B — Labels.** Carry `title` onto `PelletEntity`; held beads titled at LOD1+;
  card shows title with id demoted; drop id-as-label.
  Files: `derive/pellets.ts` (label = title, keep id), `contracts.ts`
  (`PelletEntity.title`), `render/text.ts`, `page/EntityCard.tsx`.
- **C — Legend roster.** Active-first ordering, "+N quiet" expand, full
  scrollable roster; optional per-rig alarm tick.
  Files: `page/AquariumLegend.tsx`, `page/rigLegend.ts`.
- **D — Surface attention shelf.** Generalize the rise to all four distressed
  poses; tether to rig anchor; stranded-work surface markers; reason tags.
  Files: sim/behaviors (rise target), `render` (shelf markers + tethers, reuse
  `render/tethers.ts`), `derive` (stranded-work detection: blocked/aging +
  no-live-agent-on-rig).
- **E — Active/dormant motion read.** Activity-driven school motion; dim a
  fully-dormant school. Files: `sim/` (school circulation vs rest), `render`
  (dormant dim).
- **F — Epic grouping on rig-focus.** LOD1+ re-settle beads into `parent`
  clumps with epic label; parentless → general drift. Files: `derive/formations`
  or a focus-layout module, camera/LOD gate.

## Test strategy (TDD, per workstream)

- **A:** pellet color is a pure function of rig hue only (no status branch on
  color); `radiusScaleForPriority` unchanged; a luminosity ramp test; legend
  renders zone key not status colors; a DESIGN §7 doc-sync check if one exists.
- **B:** `PelletEntity.title` populated from bead; held pellet emits a title
  label at LOD1+ and not at LOD0; card shows title, id secondary; no elided-UUID
  label path remains.
- **C:** roster orders active rigs first; "+N quiet" expands to full roster;
  a11y `aria-expanded`; hue swatch per rig.
- **D:** each distressed pose resolves to a rising target; stranded-work
  predicate (blocked/aging + no live agent on rig) true/false cases; tether
  endpoints; reason tag text per reason.
- **E:** active school has non-zero circulation, dormant school rests; dim
  factor applies only when every fish is idle/asleep.
- **F:** at LOD1+ beads partition by `parent`; parentless fall to general drift;
  epic label text; reverts to age drift at LOD0.

## Data availability (verified)

Supervisor `Bead` already carries `title`, `issue_type`, `parent`, `labels`,
`priority`, `assignee`, `dependencies`/`needs`, `status`, `created_at`. Agent
distress is the shared `AgentNeedsYouReason`. No new API work required.

## Standing constraints

Match CI locally from the worktree (`build:shared`, `typecheck` src+test, `lint`
0-warn, `frontend test`, prettier on touched, perf snap render-work p95 < 16 ms).
Never run two agents on `render/` at once. Stage by explicit path (shared
checkout); never `git add -A`; never commit the tom-managed worktree `CLAUDE.md`.
Branch-ready / HALT — no push, no PR (mayor-gated).

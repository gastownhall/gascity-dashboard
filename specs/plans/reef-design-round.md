# Reef design round — converged plan (2026-07-14 overnight, autonomous)

Design-first session Stephanie asked for: grill-me + Codex design review + converge,
then build autonomously overnight and leave **branch-ready (HALT, no push — mayor-gated)**.
This file records the decisions so she can review them in the morning.

## Grounding (live ds-research, measured this session)

- ~1000 open beads, **only 4 in_progress, 0 blocked**. The tether can physically
  connect at most ~4 fish↔bead pairs; ~996 pellets are unattached open backlog.
- **72% of beads have null priority** (47 P0, 190 P1, 2 P2, 37 P3). priority→size
  differentiates ~28% and the deltas (0.85–1.4) are invisible at ~2 px.
- 261 beads (26%) carry `dependencies[]`.
- 52 fish / 22 rigs / 11 hues. Formations packed ~164 wu apart across a 3600 wu
  seabed; drifting-pellet X spreads ±0.9·radius (~250–450 wu) so **adjacent rigs'
  clouds overlap**, and all rigs share one age-driven vertical band → "coloured dust."

## Root cause (Codex, independent): information hierarchy is inverted

The operator's subject is the **fleet**, but the visually dominant population is the
**queue**. ~40 pellets/rig × 22 rigs swamp ~52 sparse fish. Every queued morsel gets
the same visual vote as one of only 4 active assignments. Fixing this is the
highest-leverage move and it directly serves the "team ownership" complaint.

## Decisions

### 1. Association = "team ownership of the cloud" (her pick)

Two coordinated changes:

- **A1 — LOD-aware backlog thinning** (Codex #1, net-negative). At LOD0 draw all
  held + blocked + P0 + a small deterministic per-rig sample of ordinary drifting;
  more at LOD1; the existing 40/rig cap at LOD2. Exact totals stay in the formation
  label + legend (already separate from rendered count via `openBeadTotal` / overflow).
  Truthful: every visible pellet is real; fewer visible ≠ fewer beads (the per-rig
  cap already implies this). Makes the fleet the primary read and clears the dust.
- **A2 — formation-anchored feeding grounds** (Codex #3). Tighten the drifting-pellet
  horizontal spread to a recognizable feeding ground centered above the owning
  formation, and strengthen the exact `RIG · N` label so ownership reads at
  overview/LOD1 (not only at the default framing). Spatial proximity + exact text do
  the grouping, so reused hues no longer force a legend lookup. No halos/outlines.

### 2. Priority = binary P0 read (her pick: "P0 glints")

- **B1 — repair the licensed size channel** (Codex #4; DESIGN §7 says pellet size =
  priority). `radiusScaleForPriority`: P0=1.8, P1=1.35, P2=1.0, P3=0.78, **null=1.0
  (neutral — absence of priority is NOT low priority; fixes the current null≡P2 bug)**.
- **B2 — binary P0 specular glint** (her explicit pick, Codex #5). A fixed upper-left
  highlight dot on P0 pellets only, at LOD1/LOD2, single batched zero-alloc pass, no
  gradient, no animation, skipped below 1 css-px. Redundant P0 emphasis, not a 5th channel.

> **Judgment flagged for morning review:** her chosen option's blurb said "keeps size
> out of it entirely (size failed anyway)." I kept + *repaired* size (B1) rather than
> removing it, because (a) DESIGN §7 makes size the priority channel and gutting a
> contract channel autonomously is over-reach, and (b) Codex showed size didn't fail —
> it was under-tuned (0.85–1.4); 0.78–1.8 makes P0 a different order of morsel. Doing
> both makes P0 unmistakable. If she prefers the pure-glint version, drop B1 and amend
> DESIGN §7 to remove size=priority.

### 3. Bugs

- **C1 — fish pile on the right.** Under diagnosis (agent). Leading hypothesis: the
  left-to-right `Math.max(base, minX)` sweep in `placeAlongSeabed` accumulates
  rightward, right-skewing the formation centroid so a WORLD-center camera shows fish
  piled right. Fix = de-skew placement or frame the real centroid.
- **C2 — beads past frame / unfilled bottom on a tall window.** REPRODUCED (shots
  03/04). Ambience paints only to WORLD.height while the camera is width-constrained,
  so a tall viewport shows empty pale water above the waterline + a flat dead band
  below the seabed. Fix = ambience fills the whole canvas/viewport; reconsider the
  vertical clamp so a tall window doesn't reveal dead space.

### 4. Build items

- **D1 — dependency links: FOCUS-ONLY, not global** (Codex hard warning). Drawing all
  261 dependency edges globally = spaghetti + false hierarchy + re-creates the dust.
  Instead: on selecting a bead pellet, draw faint links to its immediate `depends_on`
  pellets that are also rendered + in view. Mirror `render/tethers.ts`. Carry
  `dependencies` onto `PelletEntity`.
- **D2 — click a bead pellet → open it.** Target route under investigation (agent):
  reef beads are supervisor beads; the dashboard Beads page is a different local store,
  so the target may need to be Convoy/graph, or the reef's own focus card enriched.

## Constraints held sacred

- Perf: pellets are the 1000-mark zero-alloc hot path; render-work p95 < 16 ms.
- Truthfulness (DESIGN §7): every mark a real fact; animations only on real events.
- Greyscale Test: state stays in pose/position/eye/fin; colour = rig group only.
- render/ + sim/ edits are **sequential** (HMR/race history) — no parallel agents there.
- HALT: branch-ready only, no push / no PR (mayor-gated).

## Build order (leverage-ranked)

1. Priority read (B1+B2) — self-contained, safest.
2. Unfilled-bottom bug (C2) — already diagnosed.
3. Team ownership (A1+A2) — biggest, highest leverage.
4. Fish-pile bug (C1) — after diagnosis.
5. Bead click-through (D2) — after target decision.
6. Dependency links (D1) — focus-only.
7. Finalize: gates + multi-review + live re-render + ledger. HALT.

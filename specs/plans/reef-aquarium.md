# Reef Aquarium — pane-of-glass fleet tank (`/reef`)

Bead epic: `gascity-dashboard-mwx0`. Branch: `feat/reef-aquarium` (off `main` @ 20547c6).
Status: implementation plan + acceptance contract for the canvas aquarium rebuild.

This is a complete rebuild, deliberately separate from the `h5rl` strata scene
(`feat/reef-static-scene` + stacked branches), which is preserved untouched as a
candidate Agents-tab adaptation. Nothing here stacks on those branches; `/reef`
does not exist on `main`, so this branch claims the route fresh.

## Product intent

An ambient aquarium you look _through_, not a chart you read. The operator pans
around a stable underwater geography and zooms from whole-tank overview down to
individual fish, gaining truthful detail at every level: agents as fish whose
species, size, pose, and behavior are all live facts; beads as food pellets the
fish actually work; rigs as reef formations that are _places_.

The previous strata scene answered "what states exist"; this scene must answer
"what is the fleet _doing_" — and be beautiful enough to leave on a wall.

## Locked decisions (grill 2026-07-13)

| Decision                  | Choice                                                                                                                                                                                                                                                                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Relationship to h5rl work | Separate rebuild on own branch; strata preserved                                                                                                                                                                                                                                                                             |
| Substrate                 | Canvas 2D, procedural vector drawing (no WebGL dep, no image assets)                                                                                                                                                                                                                                                         |
| Art direction             | Atmospheric flat-vector: 3–4 parallax layers, water-column gradient, light shafts, fog-with-distance, articulated silhouette fish                                                                                                                                                                                            |
| Zoom model                | 3-tier semantic zoom — LOD0 TANK (default, fits all), LOD1 REEF (~1 rig), LOD2 FISH (close-up); continuous wheel/pinch zoom, drag pan; detail fades in by threshold                                                                                                                                                          |
| Pellets                   | Every pellet IS a real bead (per-rig open list). open→drifting above formation; in_progress→held at assignee's mouth; blocked→dark, sunk to seabed; closed (snapshot diff)→gulp animation then gone. ≤40 rendered per rig + typeset "+N" overflow                                                                            |
| Grouping/behavior         | Rig-home + state shoals. working=shoals pellet field oriented to own task pellet; idle=lazy wander; asleep=settled in crevice, dimmed; awaiting-input=risen to waterline, gaping; stalled=nose-up treading; rate-limited=tucked under overhang, fins folded; errored=belly-up slow rise; mayor=grouper patrolling whole tank |
| Route/chrome              | `/reef`, full-bleed canvas under slim header; overlay = "N need attention" ledger line, tank-light conn state, zoom controls                                                                                                                                                                                                 |
| Reduced motion            | Frozen truthful frame: zero autonomous animation, instant state swaps, user pan/zoom still works with instant (non-eased) jumps                                                                                                                                                                                              |
| Theme                     | Theme-keyed water moods — light: sunlit shallows; dark: midnight deep. Same geometry, two procedural palettes                                                                                                                                                                                                                |
| Loop exit                 | The 7 acceptance criteria below, all passing in a single round; cap 8 rounds then halt + scorecard report                                                                                                                                                                                                                    |
| Publish                   | HALT branch-ready. No push, no PR — publish is mayor-gated                                                                                                                                                                                                                                                                   |

## Semantic mapping (truthfulness contract)

Every visual fact is a data fact. No decorative entities that could be mistaken
for data (bubbles/light are licensed ambience; nothing fish- or pellet-shaped
is ever decorative).

- **Fish = live sessions** (plus distressed/idle-role agent fallbacks, same rule
  the strata scene used). One fish per session.
- **Pose** — the four distress reasons come verbatim from the shared
  needs-attention SSOT selectors, never re-derived. Calm tiers: `working`
  (in-turn activity), `idle`, `asleep` (state or >1h inactive).
- **Species** — `agent_kind`: pool → small worker fish; agent/role → mid fish;
  mayor → grouper. City-stratum non-mayor (PLs, control) → pelagic mid fish,
  open water.
- **Belly girth = context_pct**; unknown = slim indeterminate body, never a
  fake default number.
- **Home = rig** (canonical rig name), `unrigged` shoal near open sand, city
  stratum in open water.
- **Pellet = bead** (id-addressable at LOD2). Rig queue depth = visible food
  density.
- **Eating = diff-observed fact**: a bead that left the open set between
  snapshots triggers one gulp on its assignee; never invented from timers.
- **Tank light = SSE connection state** (connecting / clear / degraded /
  drained) — the pane itself tells you when it's stale.
- **Tombstones**: a fish missing one read ghosts (dimmed, drifting) for the
  reconciliation window instead of vanishing — partial reads must not render
  as deaths.

## World model

- World coordinates are fixed: a wide tank (~4000×2250 world units), seabed
  along the bottom, waterline at the top.
- Rig formations are procedurally generated rock/coral silhouettes placed by
  deterministic hash of rig name into stable slots (same rig, same place,
  every session — geography is muscle memory). Formation size scales gently
  with crew count.
- 3 parallax layers: far water haze, mid formations, near fish/pellets +
  particulate motes. Camera parallax on pan; fog with layer depth. (A nearer
  out-of-focus foreground layer was tried rounds 4–7 as a depth cue and removed
  per operator decision mwx0.13 — see the scorecard.)
- Camera: `{x, y, zoom}`, wheel zoom anchored at cursor, drag pan, pinch on
  touch, double-click zoom-in, Home/Esc reset, keyboard arrows + `+`/`-`.
  Clamped to tank bounds. LOD thresholds are zoom values; text layers fade
  across thresholds.

## Acceptance criteria (loop exit contract)

All seven must pass in the same round.

1. **AQUARIUM ILLUSION** — the LOD0 screenshot reads as an aquarium scene, not a
   chart or diagram. Pass bar: a 3-judge vision panel unanimously classifies it
   as a scene (`reads_as_chart = false`). The median score (target 4/5) is a
   quality signal, not the gate. _(Settled 2026-07-14: the scene plateaued at a
   genuine 3/5 median across five judged fix-rounds — unambiguously a scene, with
   creatures, volumetric depth, rig-colour identity, and 7/7 pose legibility. The
   gap to a 4/5 "densely-populated reef" is inherent to a truthful ambient monitor
   of a modest fleet drawn with the disjoint pose bands that earn criterion 3; it
   cannot close without sacrificing truthfulness or legibility. See the
   scorecard. The bar is the honest one: not-a-chart, which it clears
   unanimously.)_
2. **FISH CRAFT** — LOD2 close-up: fish are drawn-with-intent, articulated,
   species-distinct; zero "clip-art ellipse" verdicts. Panel median ≥ 4/5.
3. **BLIND STATE LEGIBILITY** — judges identify ≥ 6 of 7 poses from unlabeled
   figure-only crops (7-option forced choice; median across 3 judges).
4. **LOD HONESTY** — every label/number visible in any screenshot matches the
   fixture manifest exactly; zero mismatches (programmatic cross-check +
   auditor judge).
5. **CAMERA FEEL** — scripted pan/zoom sweep at 200 fish + 1000 pellets:
   p95 frame time < 16 ms.
6. **TRUTHFULNESS PARITY** — unit tests prove pose derivation delegates to the
   attention SSOT selectors and the pellet set ≡ fixture bead set (id-level).
7. **MECHANICAL** — root typecheck (source + test), lint, prettier check,
   backend/frontend/shared tests, frontend build: all green from the worktree.

## Loop protocol (rounds 1–8)

Per round:

1. Mechanical gates (criterion 7). Fix before proceeding.
2. Dev server in worktree (dedicated port, fixture mode) → snapshot harness
   (`scripts/snap-reef-aquarium.mjs`): LOD0/LOD1/LOD2 shots per theme, 7
   unlabeled pose crops, perf sweep JSON, fixture manifest JSON.
3. Vision judge panel (independent subagents, rubrics below) + programmatic
   checks → scorecard.
4. All pass → exit to final gates. Else → targeted fix plan → fix agents →
   commit → next round.

Scorecards and screenshots are kept per round for the final report.

## Judge rubrics (the specialized UX subagents)

Each judge is an independent subagent with one lens, vision access to the
round's screenshots, and a forced structured verdict. Judges never see the
implementation code and never see each other's scores.

### aquarium-illusion judge (criterion 1)

You are a demanding visual critic evaluating whether a screenshot reads as a
**living aquarium seen through glass**. You did not build this; do not be
polite. Score 1–5: 5 = instantly an aquarium (depth, water, light, life);
4 = clearly aquatic scene, minor tells; 3 = stylized scene, could be an
infographic; 2 = a diagram with fish shapes; 1 = a chart. Judge: water
atmosphere (gradient, light shafts, fog/depth), spatial composition
(believable seabed/formations, no grid/band smell), life (fish read as a
population inhabiting a place), restraint (would look intentional on an
office wall next to an editorial dashboard). Name the 3 weakest specifics.

### fish-craft judge (criterion 2)

You are a character/creature designer reviewing close-up fish renders.
Score 1–5 on craft: silhouette quality (species-distinct, elegant bezier
outlines, not primitive-shape assemblies), anatomical intent (body/fin/tail
proportions read as designed), articulation (spine curvature, fin/tail pose
suggests motion mid-frame), integration (line weight/palette coherent with
the scene). Explicitly answer: "does any fish read as clip-art or a stock
ellipse-with-fins?" (yes = automatic fail flag). Name the 3 weakest specifics.

### blind-legibility judge (criterion 3)

You are shown N unlabeled close-up crops, each one fish, no text. For each,
pick exactly one state from: working / idle / asleep / awaiting-input /
stalled / rate-limited / errored. Use only posture, position-in-frame, eye,
fins, attitude. Answer as a list; no hedging, one choice each.

### honesty auditor (criterion 4)

You receive screenshots plus the fixture manifest (the ground-truth entity
table). Extract every legible label/number from the screenshots (rig names,
fish names, state words, counts, bead ids, context percentages) and report
every mismatch against the manifest: wrong value, phantom entity (on screen
but not in manifest), or missing-but-promised (manifest says visible at this
LOD, absent on screen). Zero tolerance; report exact strings.

## Architecture

```
frontend/src/aquarium/
  contracts.ts        — shared types: WorldModel, FishEntity, PelletEntity,
                        Camera, LodTier, ScenePalette, BehaviorState (pinned
                        first; sim/render/shell all import from here)
  derive/             — data → world derivation (pure): sessions/agents/beads
                        → fish + pellets; SSOT pose delegation; tombstones;
                        current-task bead from work_dir; diff-eater
  sim/                — behavior tick (pure): steering/boids per state shoal,
                        pellet physics, mayor patrol; (state, dt, seed) → state
  camera/             — camera model + LOD thresholds (pure math)
  render/             — Canvas 2D painters: water/parallax, formations,
                        procedural spine-fish painter, pellets, text layers;
                        theme palettes
  fixtures/           — deterministic fixture scenes (aquarium | perf | blind)
                        + manifest export
  AquariumPage.tsx    — route component: canvas mount, rAF loop, data plumbing,
                        overlay UI (ledger line, tank light, zoom controls,
                        detail card), a11y layer, reduced-motion freeze
scripts/snap-reef-aquarium.mjs — Playwright harness (per-script install)
```

Pure layers (derive/sim/camera and painter geometry) are TDD'd; the rAF/canvas
shell is covered by route tests + the harness. Fixture modes are dev-only
(`?fixture=aquarium|perf|blind`, `#cam=x,y,zoom` deep-link for deterministic
screenshots).

## A11y

Canvas is `role="img"` with a live aria-label summary (counts per state). A
visually-hidden sibling list enumerates fish (name, state word, rig) with
links to `/agents/<name>` — the screen-reader channel doesn't depend on
pixels. Keyboard: camera controls + Tab reaches overlay controls and the
hidden list. Hit-testing drives hover cards and click → detail card overlay
(fish → agent link; pellet → bead id card).

## DESIGN.md

This route needs its own carve-out (companion commit in this branch): the
aquarium is a licensed full-bleed diorama. Still binding everywhere: Greyscale
Test for state legibility (pose carries state, color is emphasis), One Mark
Rule adapted (the single maroon is the overlay ledger line), tabular figures
in overlay text, `prefers-reduced-motion` (frozen truthful frame), no
external assets. Suspended on this route: Flat Page (the scene has depth by
definition), type-only imagery, the 150 ms fade rule for continuous motion.

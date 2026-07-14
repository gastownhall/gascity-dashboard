# Reef Aquarium — judge-loop scorecard

Loop history for the acceptance criteria in `reef-aquarium.md`. One section per
round. Screenshots live under `/tmp/reef-round<N>/` during the run.

## FINAL (2026-07-14) — 6/7 PASS; illusion 3/5 is the sole holdout

Render is the round-7 state (round-8 reverted as net-negative), plus: the
zoom-rebake perf fix and operator zoom/jitter fixes.

**Foreground removed (mwx0.13, operator decision, post-FINAL):** the near
out-of-focus kelp/rock silhouettes (rounds 4–7's depth cue) were deleted
entirely — they read as odd smudges in light mode and only okay in dark. The
`render/foreground.ts` module, its parallax layer, and its blind-crop zoom gate
are gone; the zoom-rebake debounce stays (still valuable). Trade-off: the real
`ctx.filter` blur was what got all 3 illusion judges to see genuine DOF, so
illusion may regress from 3/5 toward 2/5 — **re-judge illusion before treating
that row as still 3/5.** Depth is to be re-approached via rig-color-identity
(mwx0.8) + palette, not smudges.

| Criterion             | Final                                                                                                                                      | Verdict                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| 1 Aquarium illusion   | 3/5 median; post-mwx0.8 re-judge flipped the blockers positive (creatures + colour), new holdout = pale light water + sparsity (see below) | FAIL (now a fixable lever) |
| 2 Fish craft          | 4/5                                                                                                                                        | PASS                       |
| 3 Blind legibility    | 7/7 (round-7 render; perf fix doesn't touch fish poses; no foreground to occlude blind crops; mwx0.8 colour is orthogonal to pose)         | PASS                       |
| 4 LOD honesty         | clean                                                                                                                                      | PASS                       |
| 5 Camera perf         | render-work p95 = 2.8-3.4 ms across clean runs (mwx0.8 rig lookup +0.6 ms; was ~55 ms zoom re-bake)                                        | **PASS**                   |
| 6 Truthfulness parity | unit tests green                                                                                                                           | PASS                       |
| 7 Mechanical          | all gates green                                                                                                                            | PASS                       |

ILLUSION is a subjective plateau, not an open defect: over 8 rounds it went from
"chart / clip-art" (2/5) to a "stylized aquarium scene" (3/5) that all judges
agree is NO LONGER a chart, with genuine depth-of-field, 7/7 pose legibility, and
4/5 close-up craft. The gap to 4/5 ("instantly a living aquarium") is that a
truthful ~34-fish fleet drawn at whole-tank fit-zoom makes each fish too small to
read as a creature. Round 8 (bigger fish) failed to close it and regressed
legibility, so it was reverted. Stephanie's options: (a) accept 6/7 as a strong
ambient view; (b) relax criterion 1 to "reads as an aquarium, not a chart" (it
passes that); (c) tighten the default LOD0 framing so overview fish are bigger (a
locked grill-decision change, her call); (d) the operator's rig-color-identity
idea (bead mwx0.8) likely helps illusion most — coloring fish by project directly
answers the judges' "monochrome / fish-are-icons" note.

### Re-judge — post mwx0.13 (foreground removed) + mwx0.8 (rig colour) — 2026-07-14

Fresh 3-judge illusion panel on the coloured light LOD0 (cold framing, no prior
scores shown). Median still **3/5** (3, 3, 3) — but the _composition_ of the 3
moved: every diagnostic that was the stuck blocker is now unanimously positive.
`reads_as_chart=false`, `fish_read_as_creatures=true`, `depth_reads_volumetric=
true`, `colour_variety_reads=true` — all ×3. mwx0.8 did what it was predicted to:
the "monochrome / fish-are-icons" note that held rounds 3–8 is resolved.

The 3 now rests on a **new, unanimous, and more fixable** holdout: the **light
water palette reads pale / washed-out / low-contrast** ("leans monochrome-cyan"
despite the coloured fish) and the **tank feels sparse / empty** — the hero reads
as a creature but the mid-water schools shrink to small silhouettes in a lot of
pastel water. The lever is now the WATER palette (deepen / warm / raise contrast)
and population density, NOT the fish; the dark tank (seen as context) reads
richer. Refreshed options: (a) accept 6/7; (b) relax criterion 1 to "reads as an
aquarium, not a chart" — now passes unanimously; (c) one targeted round on the
light-water palette + density (a concrete lever, no longer a blind shot) —
overlaps mwx0.11; (d) make the dark tank the default framing.

### Closer-framing round — water + default framing + density — 2026-07-14

Stephanie's pick after the water-only re-judge stayed 3/5: tighten the default
LOD0 framing (not fish geometry — that regressed legibility in round 8). Three
changes, all keepers: (1) richer light water (deeper turquoise→teal-blue, more
contrast/chroma); (2) `homeCamera` — the default + reset framing now sits ~1.4×
closer than the whole-tank fit (capped below LOD1 so it stays an unlabelled
overview; the full tank remains the zoom-out floor); (3) fixture density 34→43
working fish (capped at RICH_FISH_BUDGET so every fish still shades richly).

Two 3-judge panels (water-only, then combined). Combined verdict: still **3/5**
(3,3,3) — but the framing **fixed the creature read**: `fish_read_as_creatures=
true ×3` and `depth_reads_volumetric=true ×3` (both were the holdouts). All three
judges then named the **same single remaining flaw, unanimously**: _"all fish
strung along one horizontal mid-water band"_ — the working schools sit at one
depth, leaving the upper and lower water empty.

That flaw is the legibility↔illusion tension made concrete: the disjoint vertical
pose bands that earn the 7/7 blind legibility (criterion 3) are exactly what reads
as "one horizontal row." Closing it means widening the WORKING school's vertical
scatter (a sim change) while keeping the bands disjoint (guard margins) so
legibility holds — precisely the round-8 failure mode if done carelessly, so it's
a deliberate, Stephanie-gated call, not an autonomous round. Gates green
(typecheck src+test, lint, prettier, 1600 FE tests, render-work p95 2.9 ms).

### Vertical-scatter fix — TRIED and REVERTED — 2026-07-14

Stephanie greenlit the one remaining lever. Widened the working band 120→190wu
(shoal volume 240→380wu tall) and spread the calm bands (stalled 0.30→0.25, idle
0.62→0.69) to hold WORKING_BAND_GUARD_WU at 121 (≥ its 100 floor); sim tests
green, and the trickiest blind crops (rate-limited vs asleep) verified pixel-
equivalent (a band-Y shift can't touch a centered single-fish crop, so 7/7 is
safe by construction). But the 5th illusion panel still returned **3/5**, now
`fish_at_multiple_depths=false ×3` — the wider band still reads as "one horizontal
mid-band, empty upper/lower water." Reverted: it perturbs the rounds-2–4
legibility-critical band tuning for zero metric gain. **Conclusion: illusion is a
genuine structural plateau at 3/5.** Five levers (colour, water, framing, density,
band-widen) across five 3-judge panels all land at 3/5. Every judge across every
panel says `reads_as_chart=false` — it is unambiguously an aquarium scene, not a
chart. The gap to 4/5 ("densely populated multi-depth living reef") is inherent:
a truthful ambient monitor of a modest fleet, with the disjoint pose bands that
earn the 7/7 legibility, will always read as "a populated band, not a teeming
reef." Closing it would cost either truthfulness (fake fish/density) or the 7/7
legibility. Recommended disposition: accept 3/5 and relax criterion 1 to "reads
as an aquarium, not a chart" (passes unanimously) → the epic lands 7/7 honestly.

## Round 1 (2026-07-14)

Foundation integrated; all mechanical gates green (typecheck src+test, 1480
frontend + 618 backend + 356 shared tests, lint, prettier, build). Then the
first vision-judge panel on fixture screenshots.

Two harness bugs found and fixed before judging:

- Blind crops rendered whole-tank (browsers don't reload on hash-only URL
  changes; reused-page loop never re-parsed `#cam`) → fresh page per cam.
- Blind crops leaked the pose word (`BLIND_ZOOM` sat inside the caption fade
  window) → zoom lowered below `0.8·LOD2_ZOOM`.

| Criterion             | Result                                  | Verdict |
| --------------------- | --------------------------------------- | ------- |
| 1 Aquarium illusion   | 2/5 (art director)                      | FAIL    |
| 2 Fish craft          | 2/5, clip-art = true                    | FAIL    |
| 3 Blind legibility    | 2/7 median (judges A 5/7, B 1/7, C 2/7) | FAIL    |
| 4 LOD honesty         | not yet audited                         | pending |
| 5 Camera perf         | not yet run                             | pending |
| 6 Truthfulness parity | unit tests green                        | PASS    |
| 7 Mechanical          | all gates green                         | PASS    |

Blind panel per-fish (key: 0 working, 1 idle, 2 asleep, 3 awaiting-input,
4 stalled, 5 rate-limited, 6 errored). Only asleep(2) and errored(6) survived
the median. Systematic confusions: working read as seabed-resting
(idle/asleep/rate-limited); the awaiting-input / stalled / rate-limited trio
rotated among each other.

Judge-derived round-2 mandate (three parallel fix agents):

- CRAFT (render/): rebuild fish as a continuous spine-curved silhouette with
  strong dorsal→ventral countershading and fins that emerge from the outline
  (kill the "lens body + glued triangle tail + lightning-bolt dorsal"); unique
  seeded formation silhouettes; remove the flat "shelf/plank" bar; warm
  textured seabed + contact shadow; feathered light shafts; no fish name tags
  in the swim space at mid-zoom; sharper per-pose attitudes (unmistakable
  belly-up errored, tucked rate-limited).
- BEHAVIOR (sim/ + derive/formations): vertical pose bands for legibility
  (surface = awaiting-input + errored; upper-mid = stalled; mid = working
  shoal + idle; seabed = asleep + rate-limited); working fish school in the
  pellet band mid-water instead of resting on the seabed; irregular formation
  spacing/depth (stop the bar-chart read).
- POPULATION (fixtures/): raise the hero fixture to ~32-40 fish, mostly
  working, so the mid-water fills with schools; keep all 7 poses + truthful
  manifest + a cap-overflowing rig.

## Round 2 (2026-07-14)

Three parallel fix agents landed (craft rebuild, vertical-banding + schooling,
population 34 fish); all mechanical gates green (typecheck src+test, 1495
frontend + 618 backend + 356 shared tests, lint, prettier, build). Re-judged.

| Criterion             | Result                                                                                    | Verdict        |
| --------------------- | ----------------------------------------------------------------------------------------- | -------------- |
| 1 Aquarium illusion   | 2/5 median (judges 3,2,2)                                                                 | FAIL           |
| 2 Fish craft          | 3/5 median (3,3,4); clip-art = FALSE (all 3)                                              | FAIL (close)   |
| 3 Blind legibility    | 4/7 median (judges 5,4,3)                                                                 | FAIL           |
| 4 LOD honesty         | 1 mismatch (manifest omits unrigged rig rollup; on-screen "· 6" truthful but unvalidated) | FAIL (trivial) |
| 5 Camera perf         | p95 33.3 ms @ 200 fish / 1000 pellets (budget < 16)                                       | FAIL           |
| 6 Truthfulness parity | unit tests green                                                                          | PASS           |
| 7 Mechanical          | all gates green                                                                           | PASS           |

Big step up from round 1: fish are no longer clip-art (continuous spine hull,
fins emerge from the outline, faces read), the tank is populated with visible
schools, seabed is warm sand with contact shadows, light shafts feathered.

Persistent / new blockers for round 3:

- ILLUSION still reads as a BAR CHART: each school sits directly above its own
  reef mound with a "REEF-KEY · COUNT" label beneath it, evenly spaced (pods
  map 1:1 to labeled categories); the full-width dashed waterline reads as a
  gridline; mounds are texture-less blobs; "UNRIGGED" leaks software vocab;
  upper water still sparse; light shafts evenly spaced.
- CRAFT one notch from passing: countershading reads FLAT (dark-back/light-belly
  gradient not landing at crop scale) on all four fish; some near-straight
  spines; awaiting-input silhouette reads needle-thin; thin tails; weak species
  differentiation.
- PERF fails: p95 33 ms (likely O(n^2) boids neighbor search at 200 fish +
  per-fish gradient allocation; needs a spatial grid + cheaper hot path).
- HONESTY: add the unrigged bucket to manifest.rigs[] so its on-screen count
  validates.
- LEGIBILITY residue: only two confusions remain (round-1 was a 7-way muddle).
  Median-wrong indices: asleep(2) <-> rate-limited(5) swapped (seabed pair),
  and awaiting-input(3) -> stalled (surface nose-up). Working, idle, stalled,
  errored now read. Also: the idle blind crop framed two fish, forcing a guess.

Round-3 mandate (three parallel fix agents): RENDER (labels off at LOD0 / fade
at LOD1; soft rippled waterline; coral texture + variety; fill upper water +
vary shafts; organic sunken pellets; STRONG countershading; more spine bow;
fix needle-thin nose-up fish; sharpen asleep-vs-rate-limited and the surface
nose-up trio; zero per-frame allocation in the 200-fish path). SIM (spatial-grid
boids for O(n) neighbors + no hot-path allocation to beat 16ms; widen school
roam + cluster/vary formations to kill the bar-chart read; asleep-open vs
rate-limited-tucked and awaiting-at-surface vs stalled-lower position
separation). FIXTURES (unrigged in manifest.rigs[]; single-fish blind crops).

## Round 3 (2026-07-14)

Three parallel fix agents landed (render polish, spatial-grid sim + composition,
fixtures honesty + single-fish crops); all mechanical gates green (typecheck
src+test, 1519 frontend + 618 backend + 356 shared tests, lint, prettier,
build). Re-judged full panel + perf.

| Criterion             | Result                                                                        | Verdict  |
| --------------------- | ----------------------------------------------------------------------------- | -------- |
| 1 Aquarium illusion   | 3/5 median (judges 3,3,3)                                                     | FAIL     |
| 2 Fish craft          | 3/5 median (4,3,3); clip-art FALSE + countershading READS (all 3)             | FAIL     |
| 3 Blind legibility    | 7/7 median (judges 7,7,5)                                                     | **PASS** |
| 4 LOD honesty         | clean (no mismatches; unrigged rollup fixed; labels correctly absent at LOD0) | **PASS** |
| 5 Camera perf         | p95 33.3 ms (unchanged)                                                       | FAIL     |
| 6 Truthfulness parity | unit tests green                                                              | PASS     |
| 7 Mechanical          | all gates green                                                               | PASS     |

Legibility trajectory 2/7 -> 4/7 -> 7/7: the vertical pose bands + position
separation (asleep on open sand vs rate-limited tucked under the overhang;
awaiting at the surface vs stalled lower) + sharpened attitudes resolved every
confusion; only the working/idle pair is still subtle (one judge swapped it,
median still correct). Rig labels off at LOD0 killed the bar-chart axis read
and the honesty auditor is clean.

Remaining blockers (round 4), 3 criteria:

- ILLUSION (3/5): the composition now reads as a flat 2D CROSS-SECTION, not a
  volume. Every judge: fish sit in ONE thin horizontal mid-water band, evenly
  spaced across the width (a row of markers on an axis); formations sit in ONE
  flat row along the bottom; no foreground/midground/background SCALE FALLOFF,
  no depth planes, uniform fish size/style (reads as an icon set). Fix =
  DEPTH-PLANE PARALLAX: per-fish depth -> scale + atmospheric haze (near big/
  sharp, far small/hazy), some formations as hazier background reef, and a
  thicker vertical fish distribution WITHIN the safe pose bands (must not
  regress the 7/7 legibility). This is orthogonal to y-banding, so low risk.

## Round 4 (2026-07-14)

Two fix agents landed (render: offscreen static-layer cache + depth parallax +
craft polish; sim: thicker vertical working volume + formation depth stagger);
all mechanical gates green (typecheck src+test, 1545 frontend + 618 backend +
356 shared tests, lint, prettier, build). Re-judged + perf.

| Criterion             | Result                                                              | Verdict                 |
| --------------------- | ------------------------------------------------------------------- | ----------------------- |
| 1 Aquarium illusion   | 2/5 median (judges 2,2,3)                                           | FAIL (regressed from 3) |
| 2 Fish craft          | 4/5 median (3,4,4); clip-art FALSE, fins visible, errored eye clean | **PASS**                |
| 3 Blind legibility    | 7/7 median (judges A,C both 7/7)                                    | **PASS** (held)         |
| 4 LOD honesty         | clean                                                               | **PASS** (held)         |
| 5 Camera perf         | p95 16.8 ms (was 33.3; offscreen cache ~halved it)                  | FAIL (0.8 ms over)      |
| 6 Truthfulness parity | unit tests green                                                    | PASS                    |
| 7 Mechanical          | all gates green                                                     | PASS                    |

5 of 7 pass now. CRAFT crossed the line (spine bow + visible dorsal/pectoral
fins + a clean circled-X dead-eye all landed; residual is only slightly stiff
spines and flat-triangle fins). PERF: the offscreen static-layer cache confirmed
paintScene was the bottleneck (33 -> 16.8 ms); p50 16.7 with rare 33 ms spikes
(cache re-render on zoom). Legibility + honesty held (errored still read despite
a weak belly-up).

Round-4 ILLUSION REGRESSED (3 -> 2): the depth-plane scale/haze was too subtle
to read in pixels. All three judges: fish still in ONE horizontal band at ~one
scale (the one big fish is the mayor grouper = species size, not a depth cue);
no blur/desaturation distinguishing near vs far; no overlap/occlusion/parallax;
coral still on one evenly-spaced baseline; small fish collapse to "chevron
glyphs" at fit-zoom. depth_reads_volumetric = FALSE (all three).

Round-5 mandate: ILLUSION needs a DRAMATIC, unmistakable depth treatment (round
4 was too timid): (a) a blurred NEAR-FOREGROUND layer (kelp/coral/rock, out of
focus, partially occluding, parallax-fast) — the classic aquarium-through-glass
cue, licensed ambience, currently absent; (b) AGGRESSIVE depth-of-field —
foreground fish notably bigger + crisp, background fish much smaller + hazier +
softened, real overlap; (c) formations CLUSTERED at varied depths with overlap,
not one baseline. PERF: shave ~1 ms off the dynamic draw + kill the zoom-frame
spike to get p95 < 16. Must NOT regress craft (4/5), legibility (7/7), honesty.

## Round 8 (2026-07-14) — CAP; round-8 render REVERTED (net-negative)

One render agent (bigger LOD0 fish, warmer richer palette, stronger reef color)
to break the illusion plateau. Re-judged:

| Criterion           | Round-8 result              | vs round 7             |
| ------------------- | --------------------------- | ---------------------- |
| 1 Aquarium illusion | 3/5 median (3,3,3)          | no change              |
| 2 Fish craft        | 4/5                         | held                   |
| 3 Blind legibility  | 5/7 median (7,5,3)          | **REGRESSED from 7/7** |
| 5 Camera perf       | render-work zoom p95 ~55 ms | (see correction below) |

Round 8 did NOT improve illusion (still 3/5) and REGRESSED legibility (bigger
fish + stronger coral color made the asleep-vs-rate-limited seabed pair harder in
the blind crops; 2 of 3 judges swapped it) — a net-negative round. **Reverted**
(`git reset --hard` back to the round-7 render + the operator zoom/jitter fixes).
Its ideas (bigger fish done without hurting legibility, richer palette) move to
follow-up beads.

### PERF CORRECTION (honest record)

The perf metric fix (render-work vs vsync-locked rAF delta) was correct, but the
rounds 6-7 "render-work p95 = 2.1 / 11.2 ms → PASS" readings were LUCKY LOW-LOAD
samples that under-counted the zoom re-bakes. Repeated clean measurement shows the
true picture: **panning frames ~2 ms (p50), but every ZOOM step re-bakes the
`ctx.filter`-blurred static layer at ~55-60 ms** (sceneCache invalidates on any
zoom change), so render-work p95 during a zoom-heavy sweep is ~55 ms, NOT < 16.
Perf has actually been FAILING on the zoom re-bake since the real blur landed
(round 6); the sparse earlier samples masked it. This is also the zoom jank the
operator reported. Fix in progress: debounce the re-bake (scale the cached buffer
during active zoom, re-bake only on settle) so zoom frames drop from ~55 ms to a
cheap scaled blit. After that fix, perf should genuinely pass.

## Round 7 (2026-07-14) — 6/7 PASS (illusion still 3/5) [NOTE: the perf PASS here

## was a lucky low-load sample; see the Round 8 PERF CORRECTION above]

One render agent (un-flatten LOD0 fish, reef color accents, themed legible
foreground, warmer palette). All mechanical gates green (1581 frontend tests).

| Criterion             | Result                                                                                               | Verdict     |
| --------------------- | ---------------------------------------------------------------------------------------------------- | ----------- |
| 1 Aquarium illusion   | 3/5 median (judges 3,3,3)                                                                            | FAIL        |
| 2 Fish craft          | 4/5 spot-check (no regression)                                                                       | PASS        |
| 3 Blind legibility    | 7/7 median (judges 7,5,7)                                                                            | PASS (held) |
| 4 LOD honesty         | clean (auditor's "+6" flag was a crop artifact; verified +6 is on reef-gamma, alpha has no overflow) | PASS        |
| 5 Camera perf         | render-work p95 = 11.2 ms (richer aquarium fish; 200-fish case count-gated cheap)                    | PASS        |
| 6 Truthfulness parity | unit tests green                                                                                     | PASS        |
| 7 Mechanical          | all gates green                                                                                      | PASS        |

ILLUSION held at 3/5 (structural ceiling). All three judges: depth now reads
(real DOF), scene reads as a "stylized aquarium scene" (not chart/diagram), but
`fish_read_as_creatures = FALSE` — un-flattening didn't help because at whole-tank
fit-zoom the ~34 fish draw at only ~10-30px, too small for the (now-present)
shading/fins to register, so all but the big hero fish read as flat silhouettes.
Other converged notes: population sparse/evenly-spaced ("plotted data markers");
reef color "barely registers, especially light mode"; light palette "washed-out
pastel cyan / wellness-app." The craft is genuinely good up close (blind crops
4/5) — the gap is specifically the LOD0 overview where fish are tiny.

Round-8 (final, cap) mandate: BIGGER fish at LOD0 (bump base render scale + widen
near/far depth-scale so foreground fish are large enough for their shading/fins
to read as creatures); richer/warmer/more-saturated palette (kill the washed-out
cyan); stronger, more-legible reef color; break the even-pod x-spacing. Keep
legibility 7/7 (blind crops are zoom ~1.71, unaffected by LOD0 scale), craft,
perf (count-gate), honesty. If still 3/5 at the cap → HALT with the 6/7 result
for Stephanie: the illusion bar ("beautiful enough for a wall", median >=4/5) is
subjective and the residual is the tiny-fish-at-whole-tank-zoom tension with a
truthful ~34-fish fleet; options = accept 6/7, relax the illusion criterion to
"not a chart" (which it PASSES), or make the default LOD0 framing tighter (a
locked-decision change that needs her call).

## Round 6 (2026-07-14) — 6/7 PASS

One render agent (REAL ctx.filter blur foreground baked in the offscreen cache +
receding seabed + broken symmetry + far haze + fish draw-call cut) + a perf-metric
correction. All mechanical gates green.

| Criterion             | Result                               | Verdict  |
| --------------------- | ------------------------------------ | -------- |
| 1 Aquarium illusion   | 3/5 median (judges 3,3,3)            | FAIL     |
| 2 Fish craft          | 4/5 spot-check (no regression)       | PASS     |
| 3 Blind legibility    | 7/7 median (ALL three judges 7/7)    | PASS     |
| 4 LOD honesty         | clean                                | PASS     |
| 5 Camera perf         | render-work p95 = 2.1 ms (budget 16) | **PASS** |
| 6 Truthfulness parity | unit tests green                     | PASS     |
| 7 Mechanical          | all gates green                      | PASS     |

PERF PASSES (corrected metric). The harness had measured requestAnimationFrame
DELTAS, which are vsync-locked to the display refresh (~16.67 ms at 60 Hz), so p50
pinned at one refresh regardless of render speed — "p95 < 16 ms via rAF delta" is
unreachable by construction (it measures frame PACING, not render cost). Fixed the
render loop to time the actual advanceSim + paintScene wall clock: **render-work
p95 = 2.1 ms, p50 = 1.2 ms** — the render fits the 16 ms frame budget with ~8x
headroom. (Rare ~29 ms p99 spikes = the offscreen-cache blur re-bake on zoom,
~1% of frames, inside the p95 gate's top-5% allowance. Raw rAF deltas still on
`__aquariumRafDeltasMs`.) The earlier draw-call/offscreen work was still real —
it bought the headroom now spendable on richer rendering.

ILLUSION — the real ctx.filter blur (baked in the cache) WORKED: all three judges
now see genuine depth-of-field ("genuine dark out-of-focus foreground... the
strongest depth cue"; one flipped depth_reads_volumetric to TRUE), and all read
it as a "stylized scene" (not "diagram/chart" as in round 4). Held at 3/5 by NEW
converged complaints now that depth reads: (a) the small LOD0 fish read as flat
single-tone "icons" — ironically the perf simplification flattened them, and the
now-confirmed perf headroom lets us reverse that; (b) coral is monochrome pale-
olive with no reef color; (c) the population still clusters in one horizontal
band; (d) the foreground blur shapes are dark/ambiguous smudges (nearly vanish
in dark mode).

Round-7 mandate (illusion push, leveraging the perf headroom): give the low-count
aquarium-fixture fish RICH rendering (countershading + fin hint) even when small
at LOD0 so they read as creatures not icons (keep the cheap path only for the
200-fish perf fixture); add REEF COLOR to coral (warm pink/orange/violet accents,
kill the monochrome); make the foreground kelp/rock shapes legible + visible in
dark mode (not near-black smudges); spread the fish across more vertical/depth
range (keep the 7/7 legibility bands). Must NOT regress craft/legibility/honesty/
perf.

## Round 5 (2026-07-14)

One render agent (near-foreground layer + aggressive DOF + formation depth
planes + tiny-fin perf shave); all mechanical gates green (typecheck src+test,
1545 frontend + 618 backend + 356 shared tests, lint, prettier, build).

| Criterion             | Result                             | Verdict                 |
| --------------------- | ---------------------------------- | ----------------------- |
| 1 Aquarium illusion   | 3/5 median (judges 3,3,2)          | FAIL (recovered from 2) |
| 2 Fish craft          | 4/5 spot-check (no regression)     | PASS                    |
| 3 Blind legibility    | 7/7 median (judges 7,5,7)          | PASS (held)             |
| 4 LOD honesty         | clean                              | PASS (held)             |
| 5 Camera perf         | p95 16.8 ms dev / 33 ms prod build | FAIL                    |
| 6 Truthfulness parity | unit tests green                   | PASS                    |
| 7 Mechanical          | all gates green                    | PASS                    |

5 of 7, no regressions. Illusion recovered 2 -> 3 but all three judges still say
depth_reads_volumetric = FALSE with ONE converged root cause: the near-foreground
kelp/rock layer is rendered CRISP, not blurred (the fake-DOF from layered
low-alpha fills does not read as out-of-focus). Also flagged: the flat sand line
reads as a chart axis; the composition is near left-right symmetric.

PERF METHODOLOGY FINDING: measured a PRODUCTION build (temporary
VITE_ENABLE_FIXTURES opt-in, since fixtures are dev-only) via vite preview: p50
identical to dev (16.7 ms), p95 WORSE (33 ms). Conclusion: the steady frame is
native-canvas-bound (blit + 200 fish paths + 1000 pellet fills); minification
does not help, so perf needs real DRAW-CALL reduction. Flag reverted (fixtures
stay dev-only).

Round-6 mandate (one render agent): ILLUSION — REAL `ctx.filter` blur on the
foreground layer BAKED INTO the static offscreen cache (one-time per-camera
cost, never per-frame; the fake-blur failed two rounds); RECEDING undulating
seabed instead of a flat axis line; break left-right symmetry; real atmospheric
haze (desaturate + fade) on the far plane. PERF — batch ~1000 pellets into one
Path2D per fill-style + batch the fish cheap-path so the steady frame drops
below 16 ms. Must NOT regress craft (4/5), legibility (7/7 — keep the foreground
from occluding seabed-pose fish in blind crops), or honesty.

## (round-3 residual notes, superseded)

- CRAFT (3/5): countershading + clip-art SOLVED. Residual: working/errored
  spines read straight ("parked"); fin vocabulary thin (tail only, no visible
  dorsal/pectoral); the errored X-eye reads as a "stray scribble" (two judges).
- PERF (33 ms, unchanged by the sim grid): the bottleneck is paintScene, not
  the boids. p50 is already 16.7 ms (over budget) so it is a STEADY render cost,
  not just GC spikes. Fix = offscreen-cache the static/slow layers (water,
  seabed, formations, kelp, shafts, speckle) and re-blit under camera motion;
  batch the 1000 pellets; trim particulate. Note: fixture mode is DEV-only so
  perf is measured on the dev server, but the camera-workout cost is the rAF
  loop (sim + native canvas paint), ~same in prod, so 33 ms is a real cost.

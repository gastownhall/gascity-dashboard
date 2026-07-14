# Reef Aquarium — judge-loop scorecard

Loop history for the acceptance criteria in `reef-aquarium.md`. One section per
round. Screenshots live under `/tmp/reef-round<N>/` during the run.

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

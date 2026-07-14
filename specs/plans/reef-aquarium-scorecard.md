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

## <!-- SEED: re-run /impeccable document once there's code to capture the actual tokens and components. -->

name: ds-research dashboard
description: A calm, opinionated cockpit for a single Gas City operator.

---

# Design System: ds-research dashboard

## 1. Overview

**Creative North Star: "The Reading Room"**

A single-operator dashboard that reads like a thoughtfully-set page. The room is calm by default. The operator sits with it open for hours while she works on something else, glancing at it the way one glances at the spines of books on a shelf. When something is wrong, the page raises its voice the way a careful editor circles a word: with a single deliberate mark.

This system rejects the dense observability template (Datadog, Grafana, Splunk, Posthog) where every chart competes for attention and density pretends to be insight. It also rejects the dark-slate-and-neon look that every developer tool has converged on in 2026 (Linear, Vercel, Resend, the citadel default). The aesthetic lane is single-typeface editorial, in the Are.na / FT Edit / NYT Cooking-at-rest tradition. Bookish but not ornamental, confident but not loud.

**Key Characteristics:**

- Light by default. Dark optional for late-night use.
- One typeface family throughout, with weight and scale carrying the hierarchy.
- Surface is warm paper, body type is warm graphite, the single accent is maroon.
- No cards unless absolutely necessary. Sections are separated by rhythm and typography, not by containers.
- Numbers are typeset like the rest of the page: tabular figures, deliberate scale, aligned columns.

## 2. Colors

A warm restrained palette. Three roles, not five.

### Primary

- **Maroon Mark** (to be resolved during implementation; target: deep oxblood OKLCH around `oklch(38% 0.09 25)` in light theme, lifted to roughly `oklch(70% 0.10 25)` in dark theme): the only deliberate non-neutral. Used for the rare loud moment: an anomaly indicator, a focused state, a destructive action, a count that has crossed a threshold. The maroon never carries body type and never appears on more than ten percent of the visible page.

### Neutral

- **Warm Paper** (to be resolved; target: warm cream, very low chroma, very high lightness, tinted toward the maroon hue, e.g. `oklch(98% 0.008 25)`): the dominant surface. Reads as paper, not as white. Never `#fff`.
- **Warm Graphite** (to be resolved; target: warm near-black, low chroma, very low lightness, tinted toward the maroon hue, e.g. `oklch(20% 0.012 25)`): body type, headings, primary borders. Never `#000`.
- **Tea-Stain** (to be resolved; target: warm grey at roughly 45 percent lightness): secondary type, hairlines, divider rules.
- **Faint Margin** (to be resolved; target: warm grey at roughly 80 percent lightness): tertiary type, placeholder, disabled states.

### Status (always paired with a glyph and a word, never the primary signal)

- **Healthy Sage** (to be resolved; target: low-chroma green roughly 50 percent lightness): paired with an OK glyph and a word.
- **Caution Ochre** (to be resolved; target: warm amber roughly 60 percent lightness): paired with a warning glyph and a word.
- **Stuck Maroon**: same maroon as Primary, doubled-purpose for errored or stuck state. Always paired with the word.

### Named Rules

**The One Mark Rule.** The maroon appears at most once per visible viewport. If the page wants two maroons, one of them is wrong: either reread it as neutral or rethink the page.

**The Greyscale Test.** Strip every color from the page. The operator must still be able to read every state. Color is emphasis, not signal.

## 3. Typography

**Body Font:** A single warm-humanist sans across the entire system, weight range 400 to 700 (Söhne, Untitled Sans, Inter, IBM Plex Sans, or similar; final family chosen at implementation).

There is no display font. There is no serif accent. There is no monospace. The hierarchy comes entirely from size, weight, and tracking within one family. Tabular figures are required for any column of numbers.

**Character:** A single typeface read as a held note. The system's confidence comes from refusing to switch voice. When the operator reads the page, the type stays out of the way; when she reads a number, the figures line up; when she reads a heading, the size and weight do the work that cards and boxes do elsewhere.

### Hierarchy

- **Display** (weight 600, around 2.5rem, line-height 1.05, tracking -0.02em): view name at the top of a page. Used once per route.
- **Headline** (weight 600, around 1.5rem, line-height 1.15): section openers within a view. Two to four per route.
- **Title** (weight 500, around 1rem, line-height 1.35): subsection openers, row primary text in lists.
- **Body** (weight 400, around 0.9375rem, line-height 1.55, max 70ch): paragraphs of state, descriptions, prose. Tabular figures on.
- **Label** (weight 500, around 0.75rem, line-height 1.2, tracking 0.04em, all-caps): rare. Column headings and timestamp prefixes only.

### Named Rules

**The One Voice Rule.** One typeface family. No serif slip, no display font for headings, no mono for ids. If a designer reaches for a second family, they have stopped designing the system and started designing a spread.

**The Tabular Figures Rule.** Every column of numbers uses tabular figures. Body prose may use proportional figures. No exceptions in tables, counters, or timestamps.

## 4. Elevation

Flat by default. The page has no shadows, no ambient depth, no layered surfaces at rest. Hierarchy is carried by typography and whitespace.

Shadows appear only as response to state. A focused control gains a soft inset, a hovered list row gains a faint warm surface tint. No card receives a drop shadow simply because it is a card.

### Named Rules

**The Flat Page Rule.** A section is separated from another section by space and type, not by a container. Cards are forbidden as a structural default. They appear only when a contained item needs to be physically dragged, dismissed, or stacked.

## 5. Components

No components exist in this system yet. This file is a seed; re-run `/impeccable document` after the first pass of implementation lands real button, input, table, navigation, and list-row primitives. The Components section will be populated then with extracted tokens and HTML/CSS snippets.

In the meantime, every component built during initial implementation should satisfy:

- **Hierarchy by typography.** A heading is set, not boxed. A label is tracked, not tinted.
- **Whitespace as separator.** Rhythm between sections comes from space; container boundaries are a last resort.
- **One mark per region.** Maroon never appears twice in adjacent regions. If two regions both want emphasis, the page is unclear about what it is emphasising.
- **States have words.** Hover, focus, selected, disabled, errored. Every state has a textual or glyph correlate. Color is the accelerator, not the carrier.

### Workers active (Agents view)

The calm "what is working right now" section at the top of the Agents view.

- **Session-driven, not bead-driven.** It counts the live worker sessions, not the in-progress beads. The work-beads churn to zero within seconds (focus-reviews finish fast) and live in rig stores the dashboard's bead fetch doesn't reliably aggregate, while the worker sessions stay active across that churn. A worker session is the stable signal.
- **Summary line.** One calm sentence: "N workers active across rig (n), rig (n), ..." — active worker sessions grouped by clean rig name, most workers first. Orchestration (mayor, control-dispatchers, project-leads, chief-of-staff) is excluded; it directs work, it doesn't perform it.
- **Per-worker rows.** One row per active worker session: "rig · clean-worker · relative-activity". The worker name is cleaned (no path, no -gc-XXXXX session suffix). When an in-progress bead's assignee embeds that session id, the bead is appended as secondary context: "→ bead-id: title". The common case is no bead; the worker being active is the signal, so there is never an "unassigned" row.
- **One mark.** An active worker is the normal, calm case, so worker state reads neutral. At most one accent (maroon) badge per viewport: only the first stuck/failed worker, an actual anomaly, renders its state in tone.
- **Empty state.** "No workers active right now." Calm, not an alert.

### Expand-in-place lists (Runs view)

Both the Active and Historical sections of the Runs view collapse to a small default and offer a quiet "Show N more" control.

- **Same register as the Historical toggle.** The Active section gains a quiet expand-in-place control identical to the Historical "Show N more" toggle: faint tracked-uppercase text, no filled button, expands in place. Collapsed default stays MAX_VISIBLE_ACTIVE_LANES (8); no new color, no filled button, One Mark Rule unaffected.
- **Wire carries the full set.** The collapse is a render concern: the full active set crosses the wire (`RunSummary.lanes`), and the component owns the window — mirroring `RunHistory.lanes`/`MAX_HISTORICAL_LANES` (the lazy history payload behind the toggle).

## 6. Do's and Don'ts

### Do:

- **Do** typeset numbers. Tabular figures on, aligned columns, deliberate scale. A counter is type, not a meter.
- **Do** carry hierarchy in size and weight. Headings get larger and heavier; subsection openers get smaller. The eye should know where it is from the shape of the type alone.
- **Do** use whitespace as a structural element. Two sections separated by space are clearer than two sections separated by a divider rule.
- **Do** keep the maroon rare. The accent earns its visibility from its scarcity.
- **Do** pair color with a glyph or a word for every status indicator. The page must remain readable in greyscale.
- **Do** respect `prefers-reduced-motion`. SSE-driven updates fade in over roughly 150ms. No slide, no bounce, no shimmer.

### Don't:

- **Don't** look like Posthog, Datadog, Grafana, or Splunk. Density is not insight. Brand-colored chart strips are not legibility.
- **Don't** look like Linear, Vercel, or Resend. Dark slate plus neon accent plus perfectly-rounded cards is the developer-tool reflex. We explicitly reject it.
- **Don't** use side-stripe borders. A colored left-edge on a list row or card is a side-stripe. Rewrite the element with whitespace, a leading glyph, or full hairline borders.
- **Don't** use gradient text or gradient buttons. Single solid color. Emphasis through weight and size.
- **Don't** use glassmorphism, backdrop blur, or translucent surfaces. The page is paper, not glass.
- **Don't** reach for a card. A card is an admission that the type was not doing its job.
- **Don't** introduce a second typeface family. One family, the whole way through. If something needs to look different, change its weight, scale, or tracking.
- **Don't** animate layout properties (height, top, width). State changes use opacity and transform only.
- **Don't** carry meaning in color alone. Strip the page to greyscale; every state must still be readable.
- **Don't** use em dashes in UI copy. Commas, colons, semicolons, periods, or parentheses.
- **Don't** use `#000` or `#fff`. Every neutral is tinted toward the maroon hue.

## 7. /reef (the aquarium): a licensed diorama

The reef route is the one page in the system that is a scene, not a spread. It
renders the live fleet as an aquarium seen through glass: a full-bleed Canvas
2D world with a stable seabed geography (rigs as formations), sessions as
procedurally drawn fish, and open beads as food pellets. The operator pans and
zooms; detail arrives with proximity. This section is the named carve-out that
licenses it; outside this route, nothing here applies.

### Still binding on /reef

- **The Greyscale Test, carried by posture.** Every fish state must be
  identifiable with color stripped: pose, position in the water column, eye,
  and fin attitude carry the state. Color carries emphasis and rig identity
  (below), never state.
- **The One Mark Rule, adapted.** The single maroon per viewport is the
  overlay's "N need attention" ledger line. No fish, pellet, or formation is
  ever maroon.
- **Colour as fleet identity (the licensed exception).** On /reef only, hue is
  an identity channel, not merely emphasis: every session of a rig and its beads
  carry the rig's hue, so project ownership reads at a glance. This is the one
  place the system lets colour carry meaning, and it is bounded. Hue names the
  _group_, never the _state_ — state stays in pose, position, eye, and fin, so
  the Greyscale Test above still passes: strip colour and every state is still
  legible; only the group label is lost. The rig palette is a curated, vivid,
  non-maroon set (the ledger keeps maroon to itself). The four channels stay
  orthogonal: **hue** = rig, **shade** = bead status, **size and shape** = agent
  type, **pose** = agent state. The mayor's city stratum and unrigged agents
  carry no project, so they swim neutral against the coloured schools. A busy
  city has more rigs than curated hues, so hue is a _coarse_ group, not a unique
  per-rig key; the collapsible key (below) and the per-formation coloured label
  carry the exact rig. Bead status reads as three shades of the rig hue — open
  (mid), in progress (bright), blocked (dark, settled on the seabed) — and a
  hairline tethers a working fish to the in-progress bead held at its mouth, so
  the working pair reads as one unit without a hover.
- **Pellets carry bead metadata as food behaviour, not a chart.** Beyond hue
  (rig) and shade (status), an open bead's other facts read diegetically: its
  **age** is its drift height (fresh food floats high, stale food sinks toward
  but stays above the seabed, so the vertical spread reads backlog staleness);
  its **priority** is its morsel size (a higher-priority bead is a bigger,
  choicer morsel), spread wide enough that a P0 is a different order of morsel
  rather than a subtly larger dot, with an unprioritised bead sized neutrally
  (never smaller than a known low priority — absence of a priority is not
  evidence of low priority); and a **newly-created** bead falls in from the
  surface like scattered food (the arrival twin of the closing gulp). Pellet
  size is bead priority here, distinct from fish size = agent type — the two
  marks never collide. A **P0** morsel additionally carries a fixed specular
  glint from LOD1 up (a single up-left catchlight, no gradient, no animation):
  redundant emphasis on the highest-priority beads, not a fifth channel, so the
  scarce P0s read at a glance without inventing a new variable. Each stays
  truthful: age is `created_at`, size and glint are `priority`, the drop fires
  only on a real new bead.
- **The backlog thins with distance so the fleet stays the subject.** A busy
  city has hundreds of open beads and only a handful of live sessions, so at the
  whole-tank overview the drifting backlog is sampled to a representative slice
  (held, blocked and P0 morsels always draw); zooming in only ever adds pellets,
  and the exact per-rig totals stay in the formation label and the key. Fewer
  visible pellets never means fewer beads — the same truthful contract as the
  per-rig render cap. This keeps the operator's subject, the fleet, from
  drowning in a cloud of near-identical food.
- **The One Voice Rule and tabular figures** for all overlay and in-scene
  text. The scene draws creatures; the type stays the system's type.
- **`prefers-reduced-motion`.** The scene freezes to a truthful still frame:
  poses and positions remain facts, autonomous animation stops, state changes
  swap instantly. User-initiated pan and zoom still work, as instant jumps.
- **Truthfulness.** Nothing fish-shaped or pellet-shaped is decorative. Every
  fish is a live session, every pellet is a real bead, every count is a real
  count. Ambience (water gradient, light shafts, particulate, kelp) is
  licensed only for things no operator could mistake for data.
- **No external assets.** The scene is procedural: no sprite sheets, no image
  files, no icon fonts.

### Suspended on /reef only

- **The Flat Page Rule.** The scene has depth by definition: parallax layers,
  fog with distance, a gradient water column. The page around the canvas
  stays flat.
- **The gradient prohibition**, for the water itself. Water is a gradient;
  text and controls are not.
- **The 150ms fade rule**, for continuous motion. Swimming, drifting, and
  camera glides are continuous; discrete state changes still resolve quickly
  rather than theatrically.
- **Light-by-default's fixed surface.** The tank keys its water mood to the
  theme: sunlit shallows in light, midnight deep in dark. The dark tank is a
  scene, not a dark-slate chrome reflex.

### Named Rules

**The Pane Rule.** The reef is a window, not a page. Chrome inside the glass
is limited to the ledger line, the connection state, the zoom controls, and a
collapsible key (the rig roster mapping colour to rig name + open-bead count,
and the bead-status shade legend); everything else the operator learns by
looking at the water. The key is translucent and collapses to a single toggle,
so the glass clears on demand.

**The Honest Zoom Rule.** Zooming in may only reveal true detail. If a label,
number, or creature becomes legible at closer zoom, it must be a fact from the
live snapshot; the scene never invents detail to fill the glass.

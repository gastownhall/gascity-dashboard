// The reef's key: a quiet, collapsible roster mapping each rig's colour to its
// name and open-bead count, plus a bead *zone* key. DESIGN §7's Pane Rule
// licenses this as chrome alongside the ledger line, connection state, and zoom
// controls — with ~21 rigs hashing into a bounded hue set, colour names a coarse
// group and this key resolves the exact rig. Bead STATUS is not a colour (hue is
// pure rig identity); it is read from where a morsel lives in the water, so the
// key teaches those zones, not shades. Translucent so the water still reads
// behind it; collapses to a single toggle. The system's type, tabular figures.

import { useState } from 'react';
import type { ReactNode } from 'react';
import type { RigLegend, RigLegendEntry } from './rigLegend';

export interface AquariumLegendProps {
  legend: RigLegend;
}

/** neutral rig swatch — the unrigged stratum carries no project hue */
const NEUTRAL_SWATCH = 'oklch(62% 0.02 250)';

/** A vivid mid swatch at the rig's identity hue: matches the school's colour
 *  channel (hue), not its depth-hazed exact pixel. */
function rigSwatchColor(hue: number | null): string {
  return hue === null ? NEUTRAL_SWATCH : `oklch(64% 0.16 ${hue})`;
}

/** Bead status is position, not colour: each zone is where that state's morsel
 *  lives in the water column, top (surface) to bottom (seabed). `frac` is padded
 *  into the track so the surface and seabed rows never clip. */
const ZONES: readonly { where: string; label: string; frac: number }[] = [
  { where: 'surface', label: 'needs help', frac: 0.08 },
  { where: 'mid-water', label: 'open', frac: 0.34 },
  { where: 'at a fish', label: 'in progress', frac: 0.52 },
  { where: 'seabed ⊘', label: 'in progress · no live agent', frac: 0.72 },
  { where: 'seabed', label: 'blocked', frac: 0.92 },
];

const TOGGLE_CLASS =
  'pointer-events-auto flex items-center gap-2 text-label uppercase tracking-wider text-fg-muted hover:text-fg transition-colors duration-150 ease-out-quart focus-mark';

export function AquariumLegend({ legend }: AquariumLegendProps) {
  const [open, setOpen] = useState(false);
  const [quietOpen, setQuietOpen] = useState(false);
  if (legend.active.length === 0 && legend.quiet.length === 0) return null;
  return (
    <div
      data-aquarium-legend
      className={`absolute left-4 z-10 flex flex-col items-start gap-2 border border-rule bg-surface/70 px-3 py-2 text-label ${open ? 'bottom-[4.5rem] w-[20rem] max-w-[calc(100vw-2rem)] sm:bottom-4' : 'bottom-4 w-auto'}`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={TOGGLE_CLASS}
      >
        <span aria-hidden="true" className="text-fg-faint">
          {open ? '▾' : '▸'}
        </span>
        <span>Map key</span>
        {!open && (
          <span className="hidden normal-case tracking-normal text-fg-faint min-[480px]:inline">
            ⊘ stranded bead: no live agent
          </span>
        )}
      </button>
      {open && (
        <div className="flex w-full min-w-0 flex-col gap-2">
          <Section title="Rigs">
            {legend.active.map((entry) => (
              <RigRow key={entry.key} entry={entry} showAgents />
            ))}
            {legend.active.length === 0 && (
              <div className="uppercase tracking-wider text-fg-faint">none active</div>
            )}
            {legend.quiet.length > 0 && (
              <QuietRoster
                quiet={legend.quiet}
                open={quietOpen}
                onToggle={() => setQuietOpen((v) => !v)}
              />
            )}
          </Section>
          <Section title="Beads">
            <ZoneKey />
            <PriorityNote />
          </Section>
          <Section title="Flow">
            <FlowKey />
          </Section>
        </div>
      )}
    </div>
  );
}

/** The expandable quiet-rig tail: rigs with no live agent. Collapsed to a single
 *  "+N quiet" toggle so the roster stays about what's active; expands to a
 *  scrollable full list so any rig's hue is still lookup-able on demand. */
function QuietRoster({
  quiet,
  open,
  onToggle,
}: {
  quiet: readonly RigLegendEntry[];
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="focus-mark flex items-center gap-1 pl-5 text-left uppercase tracking-wider text-fg-faint transition-colors duration-150 ease-out-quart hover:text-fg-muted"
      >
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>+{quiet.length} quiet
      </button>
      {open && (
        <div className="flex max-h-40 flex-col gap-0.5 overflow-y-auto pl-5">
          {quiet.map((entry) => (
            <RigRow key={entry.key} entry={entry} />
          ))}
        </div>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex w-full min-w-0 flex-col gap-0.5">
      <div className="uppercase tracking-wider text-fg-faint">{title}</div>
      {children}
    </div>
  );
}

/** A tiny water column: a hairline track with a neutral dot per zone, each named
 *  by where it sits and what state that is. Neutral on purpose — the position is
 *  the signal, never the colour. */
function ZoneKey() {
  return (
    <div className="relative" style={{ height: '7.5rem' }}>
      <span aria-hidden="true" className="absolute bottom-1 left-[3px] top-1 w-px bg-rule" />
      {ZONES.map((zone) => (
        <div
          key={zone.where}
          className="absolute left-0 flex -translate-y-1/2 items-center gap-2 whitespace-nowrap uppercase tracking-wider text-fg-muted"
          style={{ top: `${zone.frac * 100}%` }}
        >
          <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-fg-muted" />
          <span className="text-fg-faint">{zone.where}</span>
          <span>{zone.label}</span>
        </div>
      ))}
    </div>
  );
}

/** Priority reads as morsel size + a same-hue glow (bigger, brighter = higher
 *  priority); the swatches are neutral because priority rides each bead's own
 *  rig hue, not a fixed colour. */
function PriorityNote() {
  return (
    <div className="flex items-center gap-2 pt-1 uppercase tracking-normal text-fg-muted">
      <span aria-hidden="true" className="flex items-center gap-1">
        <span className="h-1 w-1 rounded-full bg-fg-faint" />
        <span className="h-1.5 w-1.5 rounded-full bg-fg-muted" />
        <span className="h-2.5 w-2.5 rounded-full bg-fg" />
      </span>
      <span className="whitespace-nowrap">bigger · brighter = priority</span>
    </div>
  );
}

function FlowKey() {
  return (
    <div className="flex items-center gap-2 uppercase tracking-wider text-fg-muted">
      <BubbleTrailGlyph />
      <span>work moved in last 15m</span>
    </div>
  );
}

function BubbleTrailGlyph() {
  return (
    <span
      role="img"
      aria-label="three bubble trail"
      className="relative inline-block h-5 w-4 shrink-0"
    >
      <span className="absolute bottom-0 left-0 h-1.5 w-1.5 rounded-full border border-fg-muted" />
      <span className="absolute bottom-1.5 right-0 h-2 w-2 rounded-full border border-fg-muted" />
      <span className="absolute right-1 top-0 h-1.5 w-1.5 rounded-full border border-fg-muted" />
    </span>
  );
}

/** How many agent names a rig row names before folding the rest into "+N" — a
 *  glance cue ("who's on this"), not the full crew (the Agents page has that). */
const AGENTS_NAMED = 3;

function agentSummary(agents: readonly string[]): string {
  if (agents.length <= AGENTS_NAMED) return agents.join(' · ');
  return `${agents.slice(0, AGENTS_NAMED).join(' · ')} +${agents.length - AGENTS_NAMED}`;
}

/** One rig row: hue swatch + rig name + open-bead count. Active rigs also carry
 *  their live agents' names on a muted sub-line — the "by whom" for goal #1, so
 *  the key answers who is on what without touching the tank. Widths are bounded
 *  (min-w-0 + truncate) so a long name never widens the panel. */
function RigRow({ entry, showAgents }: { entry: RigLegendEntry; showAgents?: boolean }) {
  return (
    <div className="flex w-full min-w-0 flex-col gap-0.5">
      <div className="flex min-w-0 items-center gap-2 uppercase tracking-wider text-fg-muted">
        <span
          aria-hidden="true"
          className="inline-block h-2.5 w-2.5 shrink-0"
          style={{ background: rigSwatchColor(entry.hue) }}
        />
        <span className="min-w-0 grow truncate">{entry.key}</span>
        <span className="tnum shrink-0 text-fg-faint">{entry.openBeadTotal} open</span>
      </div>
      {showAgents === true && entry.agents.length > 0 && (
        <div className="w-full truncate pl-[18px] normal-case tracking-normal text-fg-faint">
          {agentSummary(entry.agents)}
        </div>
      )}
    </div>
  );
}

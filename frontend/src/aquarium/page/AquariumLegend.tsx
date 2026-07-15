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
import type { RigLegend } from './rigLegend';

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
  { where: 'mid-water', label: 'open', frac: 0.42 },
  { where: 'at a fish', label: 'in progress', frac: 0.6 },
  { where: 'seabed', label: 'blocked', frac: 0.92 },
];

const TOGGLE_CLASS =
  'pointer-events-auto flex items-center gap-2 text-label uppercase tracking-wider text-fg-muted hover:text-fg transition-colors duration-150 ease-out-quart focus-mark';

export function AquariumLegend({ legend }: AquariumLegendProps) {
  const [open, setOpen] = useState(true);
  if (legend.entries.length === 0) return null;
  return (
    <div className="absolute bottom-4 left-4 z-10 flex max-w-[15rem] flex-col items-start gap-2 border border-rule bg-surface/70 px-3 py-2 text-label backdrop-blur-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={TOGGLE_CLASS}
      >
        <span aria-hidden="true" className="text-fg-faint">
          {open ? '▾' : '▸'}
        </span>
        Key
      </button>
      {open && (
        <div className="flex flex-col gap-2">
          <Section title="Rigs">
            {legend.entries.map((entry) => (
              <Row
                key={entry.key}
                swatch={rigSwatchColor(entry.hue)}
                label={entry.key}
                count={entry.openBeadTotal}
              />
            ))}
            {legend.hiddenCount > 0 && (
              <div className="pl-5 uppercase tracking-wider text-fg-faint">
                +{legend.hiddenCount} more
              </div>
            )}
          </Section>
          <Section title="Beads">
            <ZoneKey />
            <PriorityNote />
          </Section>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
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
    <div className="relative" style={{ height: '3.5rem' }}>
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
    <div className="flex items-center gap-2 pt-1 uppercase tracking-wider text-fg-muted">
      <span aria-hidden="true" className="flex items-center gap-1">
        <span className="h-1 w-1 rounded-full bg-fg-faint" />
        <span className="h-1.5 w-1.5 rounded-full bg-fg-muted" />
        <span className="h-2.5 w-2.5 rounded-full bg-fg" />
      </span>
      <span>bigger · brighter = priority</span>
    </div>
  );
}

function Row({ swatch, label, count }: { swatch: string; label: string; count?: number }) {
  return (
    <div className="flex items-center gap-2 uppercase tracking-wider text-fg-muted">
      <span
        aria-hidden="true"
        className="inline-block h-2.5 w-2.5 shrink-0"
        style={{ background: swatch }}
      />
      <span className="grow truncate">{label}</span>
      {count !== undefined && <span className="tnum text-fg-faint">{count}</span>}
    </div>
  );
}

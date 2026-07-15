// The reef's key: a quiet, collapsible roster mapping each rig's colour to its
// name and open-bead count, plus a bead-status shade key. DESIGN §7's Pane Rule
// licenses this as chrome alongside the ledger line, connection state, and zoom
// controls — with ~21 rigs hashing into a bounded hue set, colour names a coarse
// group and this key resolves the exact rig (and what the three bead shades
// mean). Translucent so the water still reads behind it; collapses to a single
// toggle so the operator can clear the glass. The system's type, tabular figures.

import { useState } from 'react';
import type { ReactNode } from 'react';
import type { RigLegend } from './rigLegend';

/** representative in-scene shade of each bead status, for the status key */
export interface BeadStatusColors {
  open: string;
  inProgress: string;
  blocked: string;
}

export interface AquariumLegendProps {
  legend: RigLegend;
  statusColors: BeadStatusColors;
}

/** neutral rig swatch — the unrigged stratum carries no project hue */
const NEUTRAL_SWATCH = 'oklch(62% 0.02 250)';

/** A vivid mid swatch at the rig's identity hue: matches the school's colour
 *  channel (hue), not its depth-hazed exact pixel. */
function rigSwatchColor(hue: number | null): string {
  return hue === null ? NEUTRAL_SWATCH : `oklch(64% 0.16 ${hue})`;
}

const TOGGLE_CLASS =
  'pointer-events-auto flex items-center gap-2 text-label uppercase tracking-wider text-fg-muted hover:text-fg transition-colors duration-150 ease-out-quart focus-mark';

export function AquariumLegend({ legend, statusColors }: AquariumLegendProps) {
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
            <Row swatch={statusColors.open} label="open" />
            <Row swatch={statusColors.inProgress} label="in progress" />
            <Row swatch={statusColors.blocked} label="blocked" />
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

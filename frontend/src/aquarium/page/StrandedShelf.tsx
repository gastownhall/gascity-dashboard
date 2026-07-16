// The stranded-work shelf: a single "N stranded" pill at the surface that
// expands to a drill-in list of the orphaned beads (grouped by rig, each linking
// to its detail). Replaces the old per-rig canvas markers, which overlapped and
// could not be clicked. "Stranded" here is orphaned work only (see
// derive/stranded.ts), so this stays quiet unless an agent died mid-task — the
// One Mark stays maroon on the ledger; this pill is warn, never maroon.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { StrandedWorkItem } from '../contracts';

export interface StrandedShelfProps {
  work: readonly StrandedWorkItem[];
}

export function StrandedShelf({ work }: StrandedShelfProps) {
  const [open, setOpen] = useState(false);
  if (work.length === 0) return null;

  const ordered = [...work].sort(
    (a, b) => a.rigKey.localeCompare(b.rigKey) || a.title.localeCompare(b.title),
  );

  return (
    <div className="pointer-events-auto absolute left-4 top-24 z-10 max-w-sm sm:top-11">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="text-label uppercase tracking-wider text-warn hover:text-fg transition-colors duration-150 ease-out-quart focus-mark"
      >
        ◆ {work.length} stranded
      </button>
      {open && (
        <ul className="mt-1 max-h-[60vh] overflow-y-auto border border-rule bg-surface">
          {ordered.map((w) => (
            <li key={w.beadId}>
              <Link
                to={w.linkTo}
                className="flex gap-2 px-2 py-1 text-label text-fg-muted hover:text-fg focus-mark"
              >
                <span className="uppercase tracking-wider text-warn">{w.rigKey}</span>
                <span aria-hidden="true">·</span>
                <span className="truncate">{w.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

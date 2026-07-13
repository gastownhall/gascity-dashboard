import type { ReactNode } from 'react';
import { isBlockedStatus, isClosedStatus, isInFlightStatus } from 'gas-city-dashboard-shared';

// Status is always carried by glyph + word + color, in that order of
// importance. Strip color (the greyscale test) and the badge still
// reads. Per DESIGN.md §Status, never the primary signal — always
// paired.

export type StatusTone = 'ok' | 'warn' | 'stuck' | 'neutral';

interface StatusBadgeProps {
  tone: StatusTone;
  label: ReactNode;
  /** Override the default glyph for this tone. */
  glyph?: ReactNode;
  /** Extra trailing meta (e.g. " · att" for attached sessions). */
  trailing?: ReactNode;
  className?: string;
  title?: string;
}

const TONE_COLOR: Record<StatusTone, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  stuck: 'text-accent',
  neutral: 'text-fg-muted',
};

const TONE_GLYPH: Record<StatusTone, string> = {
  ok: '●', // ●
  warn: '▲', // ▲
  stuck: '■', // ■
  neutral: '·', // ·
};

export function StatusBadge({
  tone,
  label,
  glyph,
  trailing,
  className = '',
  title,
}: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-baseline gap-1.5 text-body ${TONE_COLOR[tone]} ${className}`}
      title={title}
    >
      <span aria-hidden className="text-[0.85em] leading-none translate-y-[1px]">
        {glyph ?? TONE_GLYPH[tone]}
      </span>
      <span>{label}</span>
      {trailing && (
        <span className="text-fg-faint text-label uppercase tracking-wider">{trailing}</span>
      )}
    </span>
  );
}

// Route the raw bead status through the shared, normalized status vocabulary so
// supervisor wire spellings tone the same way they classify: in-flight
// (in_progress / active / running) → ok, closed (closed / completed / done) →
// neutral, blocked → stuck. Cased or padded spellings ('Active', ' completed ',
// 'Blocked') resolve correctly instead of falling through to the warn default
// reserved for open / deferred / ready / unknown.
export function beadStatusTone(status: string): StatusTone {
  if (isInFlightStatus(status)) return 'ok';
  if (isClosedStatus(status)) return 'neutral';
  if (isBlockedStatus(status)) return 'stuck';
  return 'warn';
}

// Single source of truth for session/agent state → tone mapping. Aligned with
// how the gc supervisor emits agent (and session) states. Unknown states
// default to neutral so we don't lie about them. 'detached' is explicit (not a
// silent default) so reviewers see the intent. Co-located with the other tone
// mappers here so display components depend only on StatusBadge, not on the
// Agents route (which would be an import cycle: Agents imports WorkInFlight,
// WorkInFlight imported stateTone from Agents).
export function stateTone(state: string): StatusTone {
  switch (state) {
    case 'active':
    case 'running':
      return 'ok';
    case 'rate-limited':
    case 'rate_limited':
    case 'waiting':
      return 'warn';
    case 'failed':
    case 'closed':
    case 'errored':
    case 'stuck':
    case 'crashed':
      return 'stuck';
    case 'detached':
    case 'asleep':
    case 'idle':
    case 'creating':
    default:
      return 'neutral';
  }
}

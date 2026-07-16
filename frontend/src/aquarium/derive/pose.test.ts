import { describe, expect, it } from 'vitest';
import type { AgentNeedsYou } from 'gas-city-dashboard-shared';
import {
  ASLEEP_THRESHOLD_MS,
  derivePose,
  isDistressPose,
  poseWord,
  poseWordForSession,
} from './pose';

const NOW = Date.parse('2026-07-13T12:00:00.000Z');

function distress(reason: AgentNeedsYou['reason']): AgentNeedsYou {
  return { name: 'x', reason, detail: 'x', action: 'respond' };
}

describe('derivePose', () => {
  it('returns the distress reason verbatim when one is supplied, regardless of session facts', () => {
    for (const reason of ['awaiting-input', 'errored', 'rate-limited', 'stalled'] as const) {
      const pose = derivePose(distress(reason), { activity: 'in-turn', state: 'active' }, NOW);
      expect(pose).toBe(reason);
    }
  });

  it('throws when a fish has no session and no distress reason (invariant violation)', () => {
    expect(() => derivePose(undefined, undefined, NOW)).toThrow();
  });

  it('is "working" when activity is in-turn', () => {
    expect(derivePose(undefined, { activity: 'in-turn', state: 'active' }, NOW)).toBe('working');
  });

  it('is "asleep" when state is asleep or draining and there is no in-turn activity', () => {
    expect(derivePose(undefined, { state: 'asleep' }, NOW)).toBe('asleep');
    expect(derivePose(undefined, { state: 'draining' }, NOW)).toBe('asleep');
  });

  it('working (in-turn activity) outranks a stale asleep state — checked first per spec order', () => {
    expect(derivePose(undefined, { activity: 'in-turn', state: 'asleep' }, NOW)).toBe('working');
  });

  it('is "asleep" once last_active is at or past the 1h threshold', () => {
    const exactlyAtThreshold = new Date(NOW - ASLEEP_THRESHOLD_MS).toISOString();
    expect(derivePose(undefined, { state: 'active', last_active: exactlyAtThreshold }, NOW)).toBe(
      'asleep',
    );
  });

  it('is "idle" just under the 1h threshold with no in-turn activity', () => {
    const justUnder = new Date(NOW - ASLEEP_THRESHOLD_MS + 1000).toISOString();
    expect(derivePose(undefined, { state: 'active', last_active: justUnder }, NOW)).toBe('idle');
  });

  it('is "idle" when there is no activity/state signal at all', () => {
    expect(derivePose(undefined, { state: 'active' }, NOW)).toBe('idle');
  });

  it('treats an unparsable last_active as not-asleep rather than throwing', () => {
    expect(derivePose(undefined, { state: 'active', last_active: 'not-a-date' }, NOW)).toBe('idle');
  });
});

describe('isDistressPose', () => {
  it('is true for exactly the four SSOT distress reasons', () => {
    expect(isDistressPose('awaiting-input')).toBe(true);
    expect(isDistressPose('errored')).toBe(true);
    expect(isDistressPose('rate-limited')).toBe(true);
    expect(isDistressPose('stalled')).toBe(true);
  });

  it('is false for the three calm tiers', () => {
    expect(isDistressPose('working')).toBe(false);
    expect(isDistressPose('idle')).toBe(false);
    expect(isDistressPose('asleep')).toBe(false);
  });
});

describe('poseWord', () => {
  it('maps every pose to its caption word', () => {
    expect(poseWord('working')).toBe('working');
    expect(poseWord('idle')).toBe('idle');
    expect(poseWord('asleep')).toBe('asleep');
    expect(poseWord('awaiting-input')).toBe('awaiting input');
    expect(poseWord('stalled')).toBe('stalled');
    expect(poseWord('rate-limited')).toBe('rate limited');
    expect(poseWord('errored')).toBe('errored');
  });

  it('does not call an active session idle when its provider omits turn activity', () => {
    expect(
      poseWordForSession('idle', {
        state: 'active',
      }),
    ).toBe('active, turn activity unavailable');
  });

  it('does not call a running session idle when its provider omits turn activity', () => {
    expect(
      poseWordForSession('idle', {
        state: 'running',
        running: true,
      }),
    ).toBe('active, turn activity unavailable');
  });

  it('keeps an explicit provider idle signal authoritative', () => {
    expect(
      poseWordForSession('idle', {
        activity: 'idle',
        state: 'active',
      }),
    ).toBe('idle');
  });
});

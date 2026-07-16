import { describe, expect, it } from 'vitest';
import { beadStatusTone, stateTone } from './StatusBadge';

describe('beadStatusTone', () => {
  it('uses one canonical tone map for bead detail and bead list badges', () => {
    expect(beadStatusTone('in_progress')).toBe('ok');
    expect(beadStatusTone('blocked')).toBe('stuck');
    expect(beadStatusTone('open')).toBe('warn');
    expect(beadStatusTone('closed')).toBe('neutral');
    expect(beadStatusTone('deferred')).toBe('warn');
  });

  it('tones supervisor wire spellings through the shared normalized vocabulary', () => {
    // Wire-native spellings the old hardcoded switch dropped into the warn
    // default now tone the same as their bd-ledger twins.
    expect(beadStatusTone('active')).toBe('ok');
    expect(beadStatusTone('running')).toBe('ok');
    expect(beadStatusTone('completed')).toBe('neutral');
    expect(beadStatusTone('done')).toBe('neutral');
  });

  it('normalizes cased / padded spellings instead of falling through to warn', () => {
    expect(beadStatusTone('Active')).toBe('ok');
    expect(beadStatusTone(' completed ')).toBe('neutral');
    expect(beadStatusTone('Blocked')).toBe('stuck');
  });
});

describe('stateTone', () => {
  it("classifies 'crashed' as stuck, alongside failed/errored/stuck", () => {
    // shared/src/agents/needsYou.ts FAILURE_STATES already includes 'crashed'
    // (an agent needing the operator); stateTone previously fell through to
    // 'neutral' for it, disagreeing with the needs-you selector's own claim
    // that the two classify a state the same way (gascity-dashboard-h5rl.2).
    expect(stateTone('crashed')).toBe('stuck');
    expect(stateTone('failed')).toBe('stuck');
    expect(stateTone('errored')).toBe('stuck');
    expect(stateTone('stuck')).toBe('stuck');
  });
});

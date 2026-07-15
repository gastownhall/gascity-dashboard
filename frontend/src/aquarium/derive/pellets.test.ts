import { describe, expect, it } from 'vitest';
import type { Bead } from 'gas-city-dashboard-shared/gc-supervisor';
import { PELLET_RENDER_CAP_PER_RIG } from '../contracts';
import {
  ageFractionFor,
  beadLinkTo,
  buildPellets,
  radiusScaleForPriority,
  isP0Priority,
  type BuildPelletsInputs,
} from './pellets';

/** matches the fixture beads' created_at, so age reads 0 unless a test sets it */
const NOW = Date.parse('2026-01-01T00:00:00Z');

function bead(id: string, status: string, assignee?: string, title?: string): Bead {
  return {
    id,
    created_at: '2026-01-01T00:00:00Z',
    issue_type: 'task',
    status,
    title: title ?? id,
    ...(assignee === undefined ? {} : { assignee }),
  };
}

describe('buildPellets', () => {
  it('maps open/in_progress/blocked to drifting/held/sunken', () => {
    const inputs: BuildPelletsInputs = {
      beadsByRig: {
        alpha: {
          items: [
            bead('a-1', 'open'),
            bead('a-2', 'in_progress', 'polecat-gc-1'),
            bead('a-3', 'blocked'),
          ],
          total: 3,
        },
      },
      sessionIdsByFishId: new Map([['fish-1', 'gc-1']]),
      nowMs: NOW,
      prevBeadIds: new Set(),
    };
    const { pellets } = buildPellets(inputs);
    const byId = new Map(pellets.map((p) => [p.beadId, p]));
    expect(byId.get('a-1')?.state).toBe('drifting');
    expect(byId.get('a-2')?.state).toBe('held');
    expect(byId.get('a-2')?.fishId).toBe('fish-1');
    expect(byId.get('a-3')?.state).toBe('sunken');
  });

  it('drops beads whose status is not open/in_progress/blocked (e.g. closed)', () => {
    const inputs: BuildPelletsInputs = {
      beadsByRig: { alpha: { items: [bead('a-1', 'closed')], total: 1 } },
      sessionIdsByFishId: new Map(),
      nowMs: NOW,
      prevBeadIds: new Set(),
    };
    expect(buildPellets(inputs).pellets).toEqual([]);
  });

  it('normalizes status casing/whitespace (isOpenStatus etc. are the SSOT)', () => {
    const inputs: BuildPelletsInputs = {
      beadsByRig: { alpha: { items: [bead('a-1', ' Open '), bead('a-2', 'BLOCKED')], total: 2 } },
      sessionIdsByFishId: new Map(),
      nowMs: NOW,
      prevBeadIds: new Set(),
    };
    const byId = new Map(buildPellets(inputs).pellets.map((p) => [p.beadId, p]));
    expect(byId.get('a-1')?.state).toBe('drifting');
    expect(byId.get('a-2')?.state).toBe('sunken');
  });

  it('leaves held pellets fishId undefined when the assignee has no matching session', () => {
    const inputs: BuildPelletsInputs = {
      beadsByRig: { alpha: { items: [bead('a-1', 'in_progress', 'polecat-gc-999')], total: 1 } },
      sessionIdsByFishId: new Map([['fish-1', 'gc-1']]),
      nowMs: NOW,
      prevBeadIds: new Set(),
    };
    expect(buildPellets(inputs).pellets[0]?.fishId).toBeUndefined();
  });

  it('caps rendered pellets per rig, preferring held then sunken then drifting, and reports overflow', () => {
    const items: Bead[] = [];
    for (let i = 0; i < PELLET_RENDER_CAP_PER_RIG + 10; i += 1) items.push(bead(`d-${i}`, 'open'));
    items.push(bead('held-1', 'in_progress', 'polecat-gc-1'));
    items.push(bead('sunk-1', 'blocked'));
    const inputs: BuildPelletsInputs = {
      beadsByRig: { alpha: { items, total: items.length } },
      sessionIdsByFishId: new Map([['fish-1', 'gc-1']]),
      nowMs: NOW,
      prevBeadIds: new Set(),
    };
    const { pellets, pelletOverflow } = buildPellets(inputs);
    expect(pellets).toHaveLength(PELLET_RENDER_CAP_PER_RIG);
    expect(pellets.some((p) => p.beadId === 'held-1')).toBe(true);
    expect(pellets.some((p) => p.beadId === 'sunk-1')).toBe(true);
    expect(pelletOverflow.alpha).toBe(items.length - PELLET_RENDER_CAP_PER_RIG);
  });

  it('does not report overflow for a rig at or under the cap', () => {
    const inputs: BuildPelletsInputs = {
      beadsByRig: { alpha: { items: [bead('a-1', 'open')], total: 1 } },
      sessionIdsByFishId: new Map(),
      nowMs: NOW,
      prevBeadIds: new Set(),
    };
    expect(buildPellets(inputs).pelletOverflow.alpha).toBeUndefined();
  });

  it('keeps the front (and a disambiguating tail) of a long bead id, not just the last chars', () => {
    const inputs: BuildPelletsInputs = {
      beadsByRig: {
        alpha: {
          items: [
            bead('gc-123', 'open'),
            bead('l-digest-dv0.3', 'open'),
            bead('gascity-dashboard-mwx0-extra-long-id', 'open'),
          ],
          total: 3,
        },
      },
      sessionIdsByFishId: new Map(),
      nowMs: NOW,
      prevBeadIds: new Set(),
    };
    const byId = new Map(buildPellets(inputs).pellets.map((p) => [p.beadId, p]));
    // short ids are shown verbatim
    expect(byId.get('gc-123')?.label).toBe('gc-123');
    // a just-too-long id keeps its readable front and its version tail
    expect(byId.get('l-digest-dv0.3')?.label).toBe('l-digest…v0.3');
    // a very long id keeps the FRONT (the rig-prefixed name), middle-elided —
    // the old leading-ellipsis dropped the front entirely
    const long = byId.get('gascity-dashboard-mwx0-extra-long-id')?.label;
    expect(long).toBe('gascity-…g-id');
    expect(long?.startsWith('gascity-')).toBe(true);
  });

  it('carries the bead title onto the pellet for the hover/click card', () => {
    const inputs: BuildPelletsInputs = {
      beadsByRig: {
        alpha: { items: [bead('a-1', 'open', undefined, 'wire the reef legend')], total: 1 },
      },
      sessionIdsByFishId: new Map(),
      nowMs: NOW,
      prevBeadIds: new Set(),
    };
    expect(buildPellets(inputs).pellets[0]?.title).toBe('wire the reef legend');
  });

  it('stamps every pellet with its owning rig key', () => {
    const inputs: BuildPelletsInputs = {
      beadsByRig: { alpha: { items: [bead('a-1', 'open')], total: 1 } },
      sessionIdsByFishId: new Map(),
      nowMs: NOW,
      prevBeadIds: new Set(),
    };
    expect(buildPellets(inputs).pellets[0]?.rigKey).toBe('alpha');
  });

  it('carries bead age and priority onto the pellet (height + morsel size)', () => {
    const day = 24 * 60 * 60 * 1000;
    const b: Bead = {
      ...bead('a-1', 'open'),
      priority: 0,
      created_at: new Date(NOW - 2 * day).toISOString(),
    };
    const inputs: BuildPelletsInputs = {
      beadsByRig: { alpha: { items: [b], total: 1 } },
      sessionIdsByFishId: new Map(),
      nowMs: NOW,
      prevBeadIds: new Set(),
    };
    const p = buildPellets(inputs).pellets[0];
    expect(p?.ageFraction).toBeGreaterThan(0);
    expect(p?.radiusScale).toBeGreaterThan(1);
  });

  it('marks a bead absent last derive as arriving (drop-in), never on first load', () => {
    const beadsByRig = { alpha: { items: [bead('new-1', 'open')], total: 1 } };
    const call = (prevBeadIds: Set<string>) =>
      buildPellets({ beadsByRig, sessionIdsByFishId: new Map(), nowMs: NOW, prevBeadIds });
    // first load (no prev): nothing drops in, no feeding storm
    expect(call(new Set()).pellets[0]?.arriving).toBeUndefined();
    // a bead not seen last time falls in
    expect(call(new Set(['old-1'])).pellets[0]?.arriving).toBe(true);
    // a bead already present last time is settled
    expect(call(new Set(['new-1'])).pellets[0]?.arriving).toBeUndefined();
  });
});

describe('ageFractionFor', () => {
  const day = 24 * 60 * 60 * 1000;
  it('reads 0 for fresh, clamps to 1 for ancient, and rises monotonically between', () => {
    expect(ageFractionFor(new Date(NOW).toISOString(), NOW)).toBe(0);
    const oneDay = ageFractionFor(new Date(NOW - day).toISOString(), NOW);
    const fiveDay = ageFractionFor(new Date(NOW - 5 * day).toISOString(), NOW);
    expect(oneDay).toBeGreaterThan(0);
    expect(fiveDay).toBeGreaterThan(oneDay);
    expect(ageFractionFor(new Date(NOW - 400 * day).toISOString(), NOW)).toBe(1);
  });

  it('reads an unparseable or future timestamp as fresh', () => {
    expect(ageFractionFor('not-a-date', NOW)).toBe(0);
    expect(ageFractionFor(new Date(NOW + 1000).toISOString(), NOW)).toBe(0);
  });
});

describe('radiusScaleForPriority', () => {
  it('makes a higher-priority bead (lower number) a bigger morsel; unset is neutral', () => {
    expect(radiusScaleForPriority(0)).toBeGreaterThan(radiusScaleForPriority(1));
    expect(radiusScaleForPriority(1)).toBeGreaterThan(radiusScaleForPriority(2));
    expect(radiusScaleForPriority(2)).toBeGreaterThan(radiusScaleForPriority(3));
    expect(radiusScaleForPriority(null)).toBe(1);
    expect(radiusScaleForPriority(undefined)).toBe(1);
  });

  it('spreads P0 wide enough to be a different order of morsel (survives 2px rasterization)', () => {
    // P0 vs P1 is a >=1.3x jump, not a fractional nudge that dies at overview.
    expect(radiusScaleForPriority(0) / radiusScaleForPriority(1)).toBeGreaterThan(1.3);
    expect(radiusScaleForPriority(0)).toBe(1.8);
  });

  it('treats null as NEUTRAL, not low: an unprioritised bead is never smaller than a known P2', () => {
    expect(radiusScaleForPriority(null)).toBe(radiusScaleForPriority(2));
    expect(radiusScaleForPriority(null)).toBeGreaterThan(radiusScaleForPriority(3));
  });
});

describe('beadLinkTo', () => {
  it('links a bead to its supervisor bead-detail route, url-encoded', () => {
    expect(beadLinkTo('mem-shs5t')).toBe('/beads?bead=mem-shs5t');
    expect(beadLinkTo('a b/c')).toBe(`/beads?bead=${encodeURIComponent('a b/c')}`);
  });

  it('is carried onto a derived pellet', () => {
    const p = buildPellets({
      beadsByRig: { alpha: { items: [bead('a-1', 'open')], total: 1 } },
      sessionIdsByFishId: new Map(),
      nowMs: NOW,
      prevBeadIds: new Set(),
    }).pellets[0];
    expect(p?.linkTo).toBe('/beads?bead=a-1');
  });
});

describe('isP0Priority', () => {
  it('is true only for a present priority <= 0', () => {
    expect(isP0Priority(0)).toBe(true);
    expect(isP0Priority(-1)).toBe(true);
    expect(isP0Priority(1)).toBe(false);
    expect(isP0Priority(2)).toBe(false);
    expect(isP0Priority(null)).toBe(false);
    expect(isP0Priority(undefined)).toBe(false);
  });

  it('is carried onto the pellet only for P0 beads', () => {
    const p0 = buildPellets({
      beadsByRig: { alpha: { items: [{ ...bead('a-0', 'open'), priority: 0 }], total: 1 } },
      sessionIdsByFishId: new Map(),
      nowMs: NOW,
      prevBeadIds: new Set(),
    }).pellets[0];
    const p2 = buildPellets({
      beadsByRig: { alpha: { items: [{ ...bead('a-2', 'open'), priority: 2 }], total: 1 } },
      sessionIdsByFishId: new Map(),
      nowMs: NOW,
      prevBeadIds: new Set(),
    }).pellets[0];
    expect(p0?.isP0).toBe(true);
    expect(p2?.isP0).toBeUndefined();
  });
});

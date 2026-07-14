import { describe, expect, it } from 'vitest';
import type { Bead } from 'gas-city-dashboard-shared/gc-supervisor';
import { PELLET_RENDER_CAP_PER_RIG } from '../contracts';
import { buildPellets, type BuildPelletsInputs } from './pellets';

function bead(id: string, status: string, assignee?: string): Bead {
  return {
    id,
    created_at: '2026-01-01T00:00:00Z',
    issue_type: 'task',
    status,
    title: id,
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
    };
    expect(buildPellets(inputs).pellets).toEqual([]);
  });

  it('normalizes status casing/whitespace (isOpenStatus etc. are the SSOT)', () => {
    const inputs: BuildPelletsInputs = {
      beadsByRig: { alpha: { items: [bead('a-1', ' Open '), bead('a-2', 'BLOCKED')], total: 2 } },
      sessionIdsByFishId: new Map(),
    };
    const byId = new Map(buildPellets(inputs).pellets.map((p) => [p.beadId, p]));
    expect(byId.get('a-1')?.state).toBe('drifting');
    expect(byId.get('a-2')?.state).toBe('sunken');
  });

  it('leaves held pellets fishId undefined when the assignee has no matching session', () => {
    const inputs: BuildPelletsInputs = {
      beadsByRig: { alpha: { items: [bead('a-1', 'in_progress', 'polecat-gc-999')], total: 1 } },
      sessionIdsByFishId: new Map([['fish-1', 'gc-1']]),
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
    };
    expect(buildPellets(inputs).pelletOverflow.alpha).toBeUndefined();
  });

  it('labels a short bead id verbatim and truncates a long one to its last 12 chars with an ellipsis', () => {
    const inputs: BuildPelletsInputs = {
      beadsByRig: {
        alpha: {
          items: [bead('gc-123', 'open'), bead('gascity-dashboard-mwx0-extra-long-id', 'open')],
          total: 2,
        },
      },
      sessionIdsByFishId: new Map(),
    };
    const byId = new Map(buildPellets(inputs).pellets.map((p) => [p.beadId, p]));
    expect(byId.get('gc-123')?.label).toBe('gc-123');
    const longLabel = byId.get('gascity-dashboard-mwx0-extra-long-id')?.label;
    expect(longLabel).toBe('…xtra-long-id');
    expect(longLabel?.length).toBe(13);
  });

  it('stamps every pellet with its owning rig key', () => {
    const inputs: BuildPelletsInputs = {
      beadsByRig: { alpha: { items: [bead('a-1', 'open')], total: 1 } },
      sessionIdsByFishId: new Map(),
    };
    expect(buildPellets(inputs).pellets[0]?.rigKey).toBe('alpha');
  });
});

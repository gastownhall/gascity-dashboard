import { describe, expect, it } from 'vitest';
import type { Bead } from 'gas-city-dashboard-shared/gc-supervisor';
import { parseAssignee } from 'gas-city-dashboard-shared';
import { buildStrandedByRig } from './stranded';

function bead(over: Partial<Bead> & Pick<Bead, 'id'>): Bead {
  return {
    status: 'open',
    created_at: '2026-07-15T00:00:00Z',
    title: over.id,
    issue_type: 'task',
    ...over,
  };
}
function dep(id: string): { depends_on_id: string; issue_id: string; type: string } {
  return { depends_on_id: id, issue_id: 'x', type: 'blocks' };
}
function rigStore(items: Bead[]) {
  return { items, total: items.length };
}
/** an assignee string whose embedded session id we can add to the live set */
function assigneeFor(session: string): string {
  return `worker-${session}`;
}

describe('buildStrandedByRig', () => {
  it('strands an unassigned actionable bead on a rig with no live agent', () => {
    const out = buildStrandedByRig({
      beadsByRig: { geo: rigStore([bead({ id: 'b1' })]) },
      liveSessionIds: new Set(),
      liveAgentsByRig: new Map([['geo', 0]]),
    });
    expect(out).toEqual({ geo: 1 });
  });

  it('does NOT strand unassigned work on a rig that still has live agents', () => {
    const out = buildStrandedByRig({
      beadsByRig: { geo: rigStore([bead({ id: 'b1' })]) },
      liveSessionIds: new Set(),
      liveAgentsByRig: new Map([['geo', 2]]),
    });
    expect(out).toEqual({});
  });

  it('strands a bead assigned to a dead agent (orphaned work), even on a crewed rig', () => {
    const out = buildStrandedByRig({
      beadsByRig: { geo: rigStore([bead({ id: 'b1', assignee: assigneeFor('gc-900') })]) },
      liveSessionIds: new Set(['gc-100']),
      liveAgentsByRig: new Map([['geo', 3]]),
    });
    expect(out).toEqual({ geo: 1 });
  });

  it('does NOT strand a bead whose assigned agent is still live', () => {
    const live = parseAssignee(assigneeFor('gc-100')).sessionId!;
    const out = buildStrandedByRig({
      beadsByRig: { geo: rigStore([bead({ id: 'b1', assignee: assigneeFor('gc-100') })]) },
      liveSessionIds: new Set([live]),
      liveAgentsByRig: new Map([['geo', 0]]),
    });
    expect(out).toEqual({});
  });

  it('does NOT strand a bead still blocked by an OPEN dependency (it is waiting, not stranded)', () => {
    const out = buildStrandedByRig({
      beadsByRig: {
        geo: rigStore([
          bead({ id: 'child', dependencies: [dep('parent')] }),
          bead({ id: 'parent' }), // still in the store = still open = blocks
        ]),
      },
      liveSessionIds: new Set(),
      liveAgentsByRig: new Map([['geo', 0]]),
    });
    // only 'parent' (unassigned, empty rig, no deps) is stranded; 'child' waits
    expect(out).toEqual({ geo: 1 });
  });

  it('treats a dependency absent from the store as closed → the bead is actionable', () => {
    const out = buildStrandedByRig({
      beadsByRig: {
        geo: rigStore([bead({ id: 'child', dependencies: [dep('closed-parent')] })]),
      },
      liveSessionIds: new Set(),
      liveAgentsByRig: new Map([['geo', 0]]),
    });
    expect(out).toEqual({ geo: 1 });
  });

  it('never strands in-progress work (it has a live holder)', () => {
    const out = buildStrandedByRig({
      beadsByRig: { geo: rigStore([bead({ id: 'b1', status: 'in_progress' })]) },
      liveSessionIds: new Set(),
      liveAgentsByRig: new Map([['geo', 0]]),
    });
    expect(out).toEqual({});
  });

  it('counts per rig and omits rigs with none stranded', () => {
    const out = buildStrandedByRig({
      beadsByRig: {
        geo: rigStore([bead({ id: 'g1' }), bead({ id: 'g2', status: 'blocked' })]),
        aoa: rigStore([bead({ id: 'a1' })]),
      },
      liveSessionIds: new Set(),
      liveAgentsByRig: new Map([
        ['geo', 0],
        ['aoa', 5],
      ]),
    });
    expect(out).toEqual({ geo: 2 });
  });
});

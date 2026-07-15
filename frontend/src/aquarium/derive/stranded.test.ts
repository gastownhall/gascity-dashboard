import { describe, expect, it } from 'vitest';
import type { Bead } from 'gas-city-dashboard-shared/gc-supervisor';
import { parseAssignee } from 'gas-city-dashboard-shared';
import { buildStrandedWork } from './stranded';

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
/** ids of the orphaned beads a build returned, per rig */
function idsByRig(work: ReturnType<typeof buildStrandedWork>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const w of work) (out[w.rigKey] ??= []).push(w.beadId);
  return out;
}

describe('buildStrandedWork (orphaned = assigned to a dead session)', () => {
  it('does NOT strand unassigned backlog, even on a rig with no live agent', () => {
    // The key rule: an idle rig's ready backlog is backlog, not an alarm.
    const work = buildStrandedWork({
      beadsByRig: { geo: rigStore([bead({ id: 'b1' }), bead({ id: 'b2', status: 'blocked' })]) },
      liveSessionIds: new Set(),
    });
    expect(work).toEqual([]);
  });

  it('strands a bead whose assigned agent session is gone, with its rig + detail link', () => {
    const work = buildStrandedWork({
      beadsByRig: {
        geo: rigStore([
          bead({ id: 'b1', title: 'Fix the latch', assignee: assigneeFor('gc-900') }),
        ]),
      },
      liveSessionIds: new Set(['gc-100']),
    });
    expect(work).toEqual([
      { beadId: 'b1', title: 'Fix the latch', rigKey: 'geo', linkTo: '/beads?bead=b1' },
    ]);
  });

  it('strands an orphaned bead even while it still reads in_progress (stale holder)', () => {
    const work = buildStrandedWork({
      beadsByRig: {
        geo: rigStore([bead({ id: 'b1', status: 'in_progress', assignee: assigneeFor('gc-900') })]),
      },
      liveSessionIds: new Set(['gc-100']),
    });
    expect(work.map((w) => w.beadId)).toEqual(['b1']);
  });

  it('does NOT strand a bead whose assigned agent is still live', () => {
    const live = parseAssignee(assigneeFor('gc-100')).sessionId!;
    const work = buildStrandedWork({
      beadsByRig: { geo: rigStore([bead({ id: 'b1', assignee: assigneeFor('gc-100') })]) },
      liveSessionIds: new Set([live]),
    });
    expect(work).toEqual([]);
  });

  it('does NOT strand an orphaned bead still blocked by an OPEN dependency (waiting)', () => {
    const work = buildStrandedWork({
      beadsByRig: {
        geo: rigStore([
          bead({ id: 'child', assignee: assigneeFor('gc-900'), dependencies: [dep('parent')] }),
          bead({ id: 'parent', assignee: assigneeFor('gc-900') }), // still open = blocks
        ]),
      },
      liveSessionIds: new Set(['gc-100']),
    });
    // 'parent' (orphaned, no deps) strands; 'child' waits on the open dep
    expect(work.map((w) => w.beadId)).toEqual(['parent']);
  });

  it('treats a dependency absent from the store as closed → the orphaned bead is actionable', () => {
    const work = buildStrandedWork({
      beadsByRig: {
        geo: rigStore([
          bead({ id: 'child', assignee: assigneeFor('gc-900'), dependencies: [dep('closed')] }),
        ]),
      },
      liveSessionIds: new Set(['gc-100']),
    });
    expect(work.map((w) => w.beadId)).toEqual(['child']);
  });

  it('collects orphaned work across rigs, unassigned backlog excluded', () => {
    const work = buildStrandedWork({
      beadsByRig: {
        geo: rigStore([
          bead({ id: 'g1', assignee: assigneeFor('gc-900') }),
          bead({ id: 'g2', status: 'blocked', assignee: assigneeFor('gc-901') }),
        ]),
        aoa: rigStore([bead({ id: 'a1' })]), // unassigned backlog → not stranded
      },
      liveSessionIds: new Set(['gc-100']),
    });
    expect(idsByRig(work)).toEqual({ geo: ['g1', 'g2'] });
  });
});

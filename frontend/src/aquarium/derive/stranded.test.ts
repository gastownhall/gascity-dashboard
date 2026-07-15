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

describe('buildStrandedByRig (orphaned = assigned to a dead session)', () => {
  it('does NOT strand unassigned backlog, even on a rig with no live agent', () => {
    // The key rule change: an idle rig's ready backlog is backlog, not an alarm.
    const out = buildStrandedByRig({
      beadsByRig: { geo: rigStore([bead({ id: 'b1' }), bead({ id: 'b2', status: 'blocked' })]) },
      liveSessionIds: new Set(),
    });
    expect(out).toEqual({});
  });

  it('strands a bead whose assigned agent session is gone (orphaned mid-flight)', () => {
    const out = buildStrandedByRig({
      beadsByRig: { geo: rigStore([bead({ id: 'b1', assignee: assigneeFor('gc-900') })]) },
      liveSessionIds: new Set(['gc-100']),
    });
    expect(out).toEqual({ geo: 1 });
  });

  it('strands an orphaned bead even while it still reads in_progress (stale holder)', () => {
    const out = buildStrandedByRig({
      beadsByRig: {
        geo: rigStore([bead({ id: 'b1', status: 'in_progress', assignee: assigneeFor('gc-900') })]),
      },
      liveSessionIds: new Set(['gc-100']),
    });
    expect(out).toEqual({ geo: 1 });
  });

  it('does NOT strand a bead whose assigned agent is still live', () => {
    const live = parseAssignee(assigneeFor('gc-100')).sessionId!;
    const out = buildStrandedByRig({
      beadsByRig: { geo: rigStore([bead({ id: 'b1', assignee: assigneeFor('gc-100') })]) },
      liveSessionIds: new Set([live]),
    });
    expect(out).toEqual({});
  });

  it('does NOT strand an orphaned bead still blocked by an OPEN dependency (waiting)', () => {
    const out = buildStrandedByRig({
      beadsByRig: {
        geo: rigStore([
          bead({ id: 'child', assignee: assigneeFor('gc-900'), dependencies: [dep('parent')] }),
          bead({ id: 'parent', assignee: assigneeFor('gc-900') }), // still open = blocks
        ]),
      },
      liveSessionIds: new Set(['gc-100']),
    });
    // 'parent' (orphaned, no deps) strands; 'child' waits on the open dep
    expect(out).toEqual({ geo: 1 });
  });

  it('treats a dependency absent from the store as closed → the orphaned bead is actionable', () => {
    const out = buildStrandedByRig({
      beadsByRig: {
        geo: rigStore([
          bead({ id: 'child', assignee: assigneeFor('gc-900'), dependencies: [dep('closed')] }),
        ]),
      },
      liveSessionIds: new Set(['gc-100']),
    });
    expect(out).toEqual({ geo: 1 });
  });

  it('counts per rig and omits rigs with none stranded', () => {
    const out = buildStrandedByRig({
      beadsByRig: {
        geo: rigStore([
          bead({ id: 'g1', assignee: assigneeFor('gc-900') }),
          bead({ id: 'g2', status: 'blocked', assignee: assigneeFor('gc-901') }),
        ]),
        aoa: rigStore([bead({ id: 'a1' })]), // unassigned backlog → not stranded
      },
      liveSessionIds: new Set(['gc-100']),
    });
    expect(out).toEqual({ geo: 2 });
  });
});

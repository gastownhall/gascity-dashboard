import { describe, expect, it } from 'vitest';
import {
  agentProject,
  beadProject,
  isAgentOutsideRig,
  isOrchestrationAgent,
  isOrchestrationSession,
  isPerRigDispatcherAgent,
  mailProject,
  sessionProject,
} from './projectOf';

describe('beadProject', () => {
  it.each([
    ['gc-1920', 'gc'],
    ['agent-diagnostics-503', 'agent-diagnostics'],
    ['code-intel-digest-mp5', 'code-intel-digest'],
    ['codeprobe-gg9f', 'codeprobe'],
    ['codeprobe-4cl6.2', 'codeprobe'],
    ['co-ysv', 'co'],
  ])('parses %s → %s', (id, expected) => {
    expect(beadProject({ id } as never)).toBe(expected);
  });

  it('falls back to the raw id when no suffix is found', () => {
    expect(beadProject({ id: 'noprefix' } as never)).toBe('noprefix');
  });
});

describe('sessionProject', () => {
  it('uses basename of rig path', () => {
    expect(sessionProject({ rig: '/home/ds/gascity' } as never)).toEqual({
      key: 'gascity',
      label: 'gascity',
    });
    expect(sessionProject({ rig: '/home/ds/projects/zeldascension' } as never)).toEqual({
      key: 'zeldascension',
      label: 'zeldascension',
    });
  });

  it('falls back to pool then template when rig is missing', () => {
    expect(sessionProject({ pool: 'codex' } as never)).toEqual({
      key: 'codex',
      label: 'codex',
    });
    expect(sessionProject({ template: '/some/path/foo' } as never)).toEqual({
      key: 'foo',
      label: 'foo',
    });
  });

  it('returns "(no rig)" bucket when no candidate exists', () => {
    expect(sessionProject({} as never)).toEqual({
      key: '(no rig)',
      label: '(no rig)',
    });
  });

  it('normalizes the key for case + separator drift while preserving the display label', () => {
    // The whole point of the {key, label} shape: rig paths with mixed
    // case or underscores must bucket together while the header shows
    // the original form. See useListFilters' bucketer.
    expect(sessionProject({ rig: '/home/ds/projects/GEO' } as never)).toEqual({
      key: 'geo',
      label: 'GEO',
    });
    expect(sessionProject({ rig: 'scix_experiments' } as never)).toEqual({
      key: 'scix-experiments',
      label: 'scix_experiments',
    });
  });
});

describe('mailProject', () => {
  it('uses rig directly', () => {
    expect(mailProject({ rig: 'ds-research' } as never)).toBe('ds-research');
  });

  it('falls back to "(no rig)" when missing', () => {
    expect(mailProject({} as never)).toBe('(no rig)');
    expect(mailProject({ rig: '' } as never)).toBe('(no rig)');
  });
});

// ── Agent grouping (gascity-dashboard-ay6 + Phase-4 H3/M3 follow-up) ──
describe('agentProject', () => {
  it('routes cross-rig orchestration agents to the Orchestration pinned group', () => {
    expect(agentProject({ name: 'mayor' } as never)).toEqual({
      key: 'Orchestration',
      label: 'Orchestration',
    });
    expect(agentProject({ name: 'control-dispatcher' } as never)).toEqual({
      key: 'Orchestration',
      label: 'Orchestration',
    });
    expect(agentProject({ name: 'oversight-rig.chief-of-staff' } as never)).toEqual({
      key: 'Orchestration',
      label: 'Orchestration',
    });
  });

  it('uses the rig basename when rig is set (mirrors sessionProject)', () => {
    expect(agentProject({ name: 'a1', rig: '/home/ds/gascity' } as never)).toEqual({
      key: 'gascity',
      label: 'gascity',
    });
    expect(agentProject({ name: 'a2', rig: '/home/ds/projects/GEO' } as never)).toEqual({
      key: 'geo',
      label: 'GEO',
    });
  });

  it('falls back to pool when rig is absent', () => {
    expect(agentProject({ name: 'a1', pool: 'research' } as never)).toEqual({
      key: 'research',
      label: 'research',
    });
  });

  it('treats empty-string rig as absent (the supervisor uses "" for cross-rig agents)', () => {
    expect(agentProject({ name: 'a1', rig: '', pool: 'research' } as never)).toEqual({
      key: 'research',
      label: 'research',
    });
  });

  it('falls back to "(no rig)" when neither rig nor pool nor orchestration name matches', () => {
    expect(agentProject({ name: 'a1' } as never)).toEqual({
      key: '(no rig)',
      label: '(no rig)',
    });
  });

  it('does NOT classify a rig-scoped agent as orchestration even with an orchestration name (rig guard wins)', () => {
    // Guarantees the rig-guard semantics: an agent named 'mayor' that
    // somehow got scoped to a rig is treated as a rig agent, not
    // accidentally lifted into the cross-rig Orchestration group.
    expect(
      agentProject({ name: 'mayor', rig: '/home/ds/gascity' } as never),
    ).toEqual({ key: 'gascity', label: 'gascity' });
  });
});

describe('isPerRigDispatcherAgent', () => {
  it('matches a rig-scoped agent whose alias ends in /control-dispatcher', () => {
    expect(
      isPerRigDispatcherAgent({ name: 'thriva/control-dispatcher', rig: '/home/ds/thriva' } as never),
    ).toBe(true);
  });
  it('is false for the bare cross-rig control-dispatcher (no rig)', () => {
    expect(
      isPerRigDispatcherAgent({ name: 'control-dispatcher' } as never),
    ).toBe(false);
  });
  it('is false for any agent without a rig', () => {
    expect(
      isPerRigDispatcherAgent({ name: 'thriva/control-dispatcher', rig: '' } as never),
    ).toBe(false);
  });
  it('is false for a rig-scoped agent without the dispatcher suffix', () => {
    expect(
      isPerRigDispatcherAgent({ name: 'thriva/architect', rig: '/home/ds/thriva' } as never),
    ).toBe(false);
  });
});

// H3 follow-up: ORCHESTRATION_AGENT_NAMES and ORCHESTRATION_TEMPLATES are
// two separate sets in projectOf.ts (session-shape keys on `template`,
// agent-shape keys on `name`). They must stay in sync — if a new
// orchestration role is added to one and forgotten on the other, sessions
// and agents for that role end up in different buckets and the operator
// sees a half-empty group. Lock the invariant via a behavioral test that
// asserts every "orchestration" name produces the Orchestration bucket
// on BOTH `agentProject` and `isOrchestrationSession`.
describe('orchestration name sets stay in sync between sessions and agents', () => {
  const orchestrationIdentifiers = [
    'mayor',
    'control-dispatcher',
    'oversight-rig.chief-of-staff',
  ];

  it.each(orchestrationIdentifiers)(
    '"%s" is classified as orchestration on both the session AND agent shapes',
    (id) => {
      // Session-shape: template field carries the identifier.
      expect(isOrchestrationSession({ template: id } as never)).toBe(true);
      // Agent-shape: name field carries the identifier.
      expect(isOrchestrationAgent({ name: id } as never)).toBe(true);
    },
  );
});

describe('isAgentOutsideRig', () => {
  it('is true for cross-rig Orchestration agents (mayor, control-dispatcher, chief-of-staff)', () => {
    expect(isAgentOutsideRig({ name: 'mayor' } as never)).toBe(true);
    expect(isAgentOutsideRig({ name: 'control-dispatcher' } as never)).toBe(true);
    expect(isAgentOutsideRig({ name: 'oversight-rig.chief-of-staff' } as never)).toBe(true);
  });

  it('is true for the residual (no rig) bucket — no rig, no pool, not orchestration', () => {
    expect(isAgentOutsideRig({ name: 'a1' } as never)).toBe(true);
    expect(isAgentOutsideRig({ name: 'a1', rig: '' } as never)).toBe(true);
  });

  it('is false for an agent in a real rig', () => {
    expect(isAgentOutsideRig({ name: 'a1', rig: '/home/ds/gascity' } as never)).toBe(false);
  });

  it('is false for a pool-scoped agent (a pool stands in as the rig label)', () => {
    expect(isAgentOutsideRig({ name: 'a1', pool: 'research' } as never)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import type { AgentResponse } from '../generated/gc-supervisor-client/types.gen';
import { AGENT_CHIPS, AGENT_DEFAULT_CHIPS, buildAgentSynopsis, stateTone } from './Agents';

// gascity-dashboard-ay6: the Agents view consumes the supervisor's
// first-class agent roster (AgentResponse), not the session list. These tests
// pin the chip-coverage invariant on the agent shape: every state the
// supervisor reports must match at least one chip, otherwise agents in
// that state vanish silently when any chip is active (parallels the bug
// from gascity-dashboard-9yb on the session side).

// AgentResponse.state is a free `string` in the OpenAPI; this is the set
// observed in this deployment + the named states the supervisor commits
// to today. Same conservative posture as the previous NAMED_STATES list.
const NAMED_STATES = [
  'creating',
  'active',
  'asleep',
  'detached',
  'failed',
  'closed',
] as const;

function mkAgent(state: string, overrides: Partial<AgentResponse> = {}): AgentResponse {
  return {
    name: `agent-${state}`,
    available: true,
    running: state === 'active' || state === 'running',
    suspended: false,
    state,
    ...overrides,
  };
}

describe('AGENT_CHIPS', () => {
  it('every named agent state matches at least one chip', () => {
    for (const state of NAMED_STATES) {
      const agent = mkAgent(state);
      const matched = AGENT_CHIPS.some((chip) => chip.match(agent));
      expect(
        matched,
        `state "${state}" must match at least one chip, otherwise it disappears when any chip is active`,
      ).toBe(true);
    }
  });

  it('exposes a "detached" chip so detached agents stay visible under chip filters', () => {
    const detached = mkAgent('detached');
    const detachedChip = AGENT_CHIPS.find((chip) => chip.id === 'detached');
    expect(detachedChip, 'detached chip should exist').toBeDefined();
    expect(detachedChip?.match(detached)).toBe(true);
  });

  it('detached agents match only the detached chip when not running', () => {
    const detached = mkAgent('detached');
    const matchingIds = AGENT_CHIPS.filter((chip) => chip.match(detached)).map(
      (chip) => chip.id,
    );
    expect(matchingIds).toEqual(['detached']);
  });

  it('a detached agent whose process is still running matches BOTH the running and detached chips', () => {
    // gc can report state='detached' (tmux disconnected) while the
    // underlying process is still running. The running chip keys on
    // a.running===true; the detached chip keys on a.state==='detached'.
    // Detached-but-running must surface under both filters so an
    // operator scanning for 'what is alive right now' doesn't lose it
    // just because the tmux attachment is gone. Mirrors the session-side
    // invariant from gascity-dashboard-bi9.
    const detachedAndRunning = mkAgent('detached', { running: true });
    const matchingIds = AGENT_CHIPS.filter((chip) => chip.match(detachedAndRunning)).map(
      (chip) => chip.id,
    );
    expect(matchingIds).toContain('running');
    expect(matchingIds).toContain('detached');
    // Bound the match set: only those two chips, no spurious third match.
    expect(matchingIds).toHaveLength(2);
  });

  it('defaults the Agents view to the actively-running chip', () => {
    // The Agents view boots into "what's running right now" (restores
    // commit 00cad8f, lost in the useListFilters migration). The default
    // set must name the 'running' chip and only ids that AGENT_CHIPS
    // actually defines, otherwise the seed silently filters to nothing.
    expect(AGENT_DEFAULT_CHIPS).toEqual(['running']);
    const chipIds = new Set(AGENT_CHIPS.map((chip) => chip.id));
    for (const id of AGENT_DEFAULT_CHIPS) {
      expect(chipIds.has(id), `default chip "${id}" must exist in AGENT_CHIPS`).toBe(true);
    }
  });

  it('suspended agents match the suspended chip regardless of state', () => {
    // Suspended is a roster-side signal the session list never carried
    // (a suspended agent has no session). The dedicated chip lets the
    // operator slice the new agent surface by it.
    const suspended = mkAgent('asleep', { suspended: true });
    const matchingIds = AGENT_CHIPS.filter((chip) => chip.match(suspended)).map(
      (chip) => chip.id,
    );
    expect(matchingIds).toContain('suspended');
  });
});

describe('stateTone', () => {
  it('classifies detached agents explicitly (not via default fallthrough)', () => {
    // Detached is paused-alive — same neutral palette as idle/asleep, but the
    // case is explicit so a reviewer sees the intent rather than a silent
    // default. See gascity-dashboard-x4k for context.
    expect(stateTone('detached')).toBe('neutral');
  });

  it('falls through to neutral for unknown states', () => {
    // AgentResponse.state is free `string` for forward-compat. Any state
    // gc emits that the dashboard hasn't seen yet must land on neutral
    // via the default branch — not crash, not lie with a tone we picked
    // at random.
    expect(stateTone('this-state-does-not-exist')).toBe('neutral');
  });
});

describe('buildAgentSynopsis', () => {
  it('reports detached agents as a distinct count, not bucketed under idle', () => {
    const rows: AgentResponse[] = [
      mkAgent('active'),
      mkAgent('asleep'),
      mkAgent('asleep'),
      mkAgent('detached'),
    ];
    const synopsis = buildAgentSynopsis(rows);
    expect(synopsis).toContain('1 active');
    expect(synopsis).toContain('2 idle');
    expect(synopsis).toContain('1 detached');
  });

  it('omits detached from the synopsis when there are no detached agents', () => {
    const rows: AgentResponse[] = [mkAgent('active'), mkAgent('asleep')];
    expect(buildAgentSynopsis(rows)).not.toContain('detached');
  });

  it('breaks suspended out as its own count', () => {
    const rows: AgentResponse[] = [
      mkAgent('active'),
      mkAgent('asleep', { suspended: true }),
    ];
    expect(buildAgentSynopsis(rows)).toContain('1 suspended');
  });

  it('returns the empty-state sentence when no rows', () => {
    expect(buildAgentSynopsis([])).toBe('No agents configured.');
  });
});

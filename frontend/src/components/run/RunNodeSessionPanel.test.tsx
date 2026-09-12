import { cleanup, render, screen } from '@testing-library/react';
import type {
  RunDisplayNode,
  RunExecutionInstance,
  RunNodeStatus,
} from 'gas-city-dashboard-shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RunNodeSessionPanel } from './RunNodeSessionPanel';

// The panel's instance-selection logic is the unit under test; the transcript
// stream is not. Stub the hook so selecting an attached instance does not reach
// the network in jsdom and the selection assertions stay deterministic.
vi.mock('../../hooks/useSessionStream', () => ({
  useSessionStream: () => ({ status: 'idle', stream: { status: 'idle' } }),
}));

afterEach(() => cleanup());

describe('RunNodeSessionPanel', () => {
  it('distinguishes a running node with unresolved session metadata', () => {
    render(<RunNodeSessionPanel node={node('active', 'session_unresolved')} visible />);

    expect(screen.getByText('Session unresolved for the current running node.')).toBeTruthy();
  });

  it('distinguishes work that has not started a session yet', () => {
    render(<RunNodeSessionPanel node={node('ready', 'not_started')} visible />);

    expect(screen.getByText('This node has not started a session yet.')).toBeTruthy();
  });

  it('exposes selected execution instance identity for operator inspection', () => {
    render(<RunNodeSessionPanel node={node('ready', 'not_started')} visible />);

    expect(screen.getByText('Execution instance')).toBeTruthy();
    expect(screen.getByText('review-exec')).toBeTruthy();
    expect(screen.getByText('Bead')).toBeTruthy();
    expect(screen.getByText('review-bead')).toBeTruthy();
  });
});

function node(status: RunNodeStatus, reason: 'not_started' | 'session_unresolved'): RunDisplayNode {
  return {
    id: 'review',
    semanticNodeId: 'review',
    title: 'Review',
    kind: 'step',
    constructKind: 'step',
    status,
    currentBeadId: 'review',
    scope: { kind: 'run' },
    visibleInGraph: true,
    historicalOnly: false,
    iterationSummary: { kind: 'single' },
    attemptSummary: { kind: 'none' },
    visibleExecutionInstanceId: 'review',
    executionInstances: [
      {
        id: 'review-exec',
        semanticNodeId: 'review',
        beadId: 'review-bead',
        iteration: { kind: 'base' },
        attempt: { kind: 'untracked' },
        label: 'base',
        status,
        session: { kind: 'none', reason },
        currentIteration: true,
        historical: false,
      },
    ],
    controlBadges: [],
  };
}

describe('RunNodeSessionPanel — visible-instance alignment', () => {
  it('defaults to the most-progressed attempt for the M7 tied retry-shell shape, not the pending shell', () => {
    render(<RunNodeSessionPanel node={m7TiedNode()} visible />);

    // The completed attempt is the shared status-aware visible instance. The
    // panel must surface it as the default selection rather than the pending
    // retry shell, whose id sorts last under the status-agnostic
    // (iteration, attempt, id) order and which has no session to rescue it.
    expect(screen.queryAllByText('ga-wisp-o5x581')).toHaveLength(0);
    expect(screen.getAllByText('ga-wisp-n3cf3y').length).toBeGreaterThan(0);
  });

  it('keeps a live attached-streamable session as the default over the visible instance', () => {
    render(<RunNodeSessionPanel node={streamingNode()} visible />);

    // A running, streamable sibling outranks the terminal visible instance here
    // on purpose: when a node is actively streaming the operator wants that
    // transcript first. This guards the intentional exception from drift.
    expect(screen.getAllByText('ga-wisp-live').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('ga-wisp-done')).toHaveLength(0);
  });

  it('falls back to the most-progressed attached sibling when the visible instance is session-less', () => {
    render(<RunNodeSessionPanel node={sessionLessVisibleNode()} visible />);

    // The shared visible instance is the current iteration, which has not
    // started a session yet. The panel must not strand the operator on an empty
    // "no session" panel: it falls back to the prior iteration's attached
    // transcript rather than defaulting to the session-less visible instance.
    expect(screen.getAllByText('ga-wisp-prior').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('ga-wisp-current')).toHaveLength(0);
  });

  it('defaults to the attached visible instance over a later-sorting attached sibling', () => {
    render(<RunNodeSessionPanel node={attachedVisibleTiedNode()} visible />);

    // Both siblings are attached and tied on (iteration, attempt); the shared
    // visible instance sorts first by id, so the status-blind
    // (iteration, attempt, id) fallback would surface the later-sorting sibling.
    // The panel must honor the shared visible instance so the inspector default
    // and the graph node header agree on the current attempt — the common
    // completed-node case, and the one selection path the other tests leave to
    // a different clause.
    expect(screen.getAllByText('ga-wisp-aaa').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('ga-wisp-zzz')).toHaveLength(0);
  });
});

describe('RunNodeSessionPanel — prop immutability', () => {
  it('does not mutate the executionInstances array on the RunDisplayNode prop during render', () => {
    // Instances are deliberately out of compareInstances order (by attempt
    // value: 3, 1, 2). Array.prototype.sort mutates in place, so sorting the
    // prop array directly would reorder it to 1, 2, 3 as a side effect of
    // rendering. The node object is a prop owned by the caller; render must
    // not reorder it underneath them.
    const node = baseNode({
      id: 'sort-safety',
      visibleExecutionInstanceId: 'attempt-3',
      executionInstances: [
        instance({ id: 'attempt-3', attempt: { kind: 'attempt', value: 3 } }),
        instance({ id: 'attempt-1', attempt: { kind: 'attempt', value: 1 } }),
        instance({ id: 'attempt-2', attempt: { kind: 'attempt', value: 2 } }),
      ],
    });
    const originalOrder = node.executionInstances.map((entry) => entry.id);

    render(<RunNodeSessionPanel node={node} visible />);

    expect(node.executionInstances.map((entry) => entry.id)).toEqual(originalOrder);
  });
});

function instance(overrides: Partial<RunExecutionInstance> & { id: string }): RunExecutionInstance {
  return {
    semanticNodeId: 'node',
    beadId: overrides.id,
    iteration: { kind: 'base' },
    attempt: { kind: 'attempt', value: 1 },
    label: 'attempt 1',
    status: 'pending',
    session: { kind: 'none', reason: 'not_started' },
    currentIteration: true,
    historical: false,
    ...overrides,
  };
}

function baseNode(overrides: Partial<RunDisplayNode> & { id: string }): RunDisplayNode {
  return {
    semanticNodeId: overrides.id,
    title: 'Node',
    kind: 'task',
    constructKind: 'retry',
    status: 'completed',
    currentBeadId: overrides.visibleExecutionInstanceId ?? overrides.id,
    scope: { kind: 'run' },
    visibleInGraph: true,
    historicalOnly: false,
    iterationSummary: { kind: 'single' },
    attemptSummary: { kind: 'none' },
    visibleExecutionInstanceId: overrides.id,
    executionInstances: [],
    controlBadges: [],
    ...overrides,
  };
}

// Audit M7 shape: a pending retry shell tied on (iteration, attempt) with the
// completed attempt bead it spawned, where neither has a resolvable session.
function m7TiedNode(): RunDisplayNode {
  return baseNode({
    id: 'review-gemini',
    visibleExecutionInstanceId: 'ga-wisp-n3cf3y',
    executionInstances: [
      instance({
        id: 'ga-wisp-o5x581',
        status: 'pending',
        session: { kind: 'none', reason: 'not_started' },
      }),
      instance({
        id: 'ga-wisp-n3cf3y',
        status: 'completed',
        session: { kind: 'none', reason: 'session_unresolved' },
      }),
    ],
  });
}

// A terminal instance is the visible instance, but a sibling at the same
// (iteration, attempt) is still running and streamable.
function streamingNode(): RunDisplayNode {
  return baseNode({
    id: 'impl',
    status: 'active',
    visibleExecutionInstanceId: 'ga-wisp-done',
    executionInstances: [
      instance({
        id: 'ga-wisp-done',
        status: 'completed',
        session: { kind: 'none', reason: 'session_unresolved' },
      }),
      instance({
        id: 'ga-wisp-live',
        status: 'active',
        session: {
          kind: 'attached',
          link: { sessionId: 'sess-live', sessionName: 'impl run', assignee: 'worker' },
          streamable: true,
        },
      }),
    ],
  });
}

// The shared visible instance is the current loop iteration, which has not
// started a session yet, while a prior iteration completed with an attached
// transcript. The default must surface the historical transcript instead of
// the session-less visible instance.
function sessionLessVisibleNode(): RunDisplayNode {
  return baseNode({
    id: 'apply-fixes',
    status: 'ready',
    visibleExecutionInstanceId: 'ga-wisp-current',
    executionInstances: [
      instance({
        id: 'ga-wisp-prior',
        iteration: { kind: 'loop', value: 1 },
        attempt: { kind: 'attempt', value: 1 },
        status: 'completed',
        session: {
          kind: 'attached',
          link: { sessionId: 'sess-prior', sessionName: 'apply fixes i1', assignee: 'worker' },
          streamable: false,
        },
        currentIteration: false,
        historical: true,
      }),
      instance({
        id: 'ga-wisp-current',
        iteration: { kind: 'loop', value: 2 },
        attempt: { kind: 'attempt', value: 2 },
        status: 'ready',
        session: { kind: 'none', reason: 'not_started' },
      }),
    ],
  });
}

// Both the shared visible instance and a sibling tied on (iteration, attempt)
// carry an attached, non-streamable session. The visible instance sorts first
// by id, so the status-blind (iteration, attempt, id) fallback would surface
// the later-sorting sibling; the panel must default to the visible instance so
// the inspector and the graph node header stay aligned on the current attempt.
function attachedVisibleTiedNode(): RunDisplayNode {
  return baseNode({
    id: 'synthesize',
    visibleExecutionInstanceId: 'ga-wisp-aaa',
    executionInstances: [
      instance({
        id: 'ga-wisp-aaa',
        status: 'completed',
        session: {
          kind: 'attached',
          link: { sessionId: 'sess-visible', sessionName: 'synthesize', assignee: 'worker' },
          streamable: false,
        },
      }),
      instance({
        id: 'ga-wisp-zzz',
        status: 'completed',
        session: {
          kind: 'attached',
          link: {
            sessionId: 'sess-sibling',
            sessionName: 'synthesize sibling',
            assignee: 'worker',
          },
          streamable: false,
        },
      }),
    ],
  });
}

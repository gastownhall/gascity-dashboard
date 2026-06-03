import { describe, expect, it } from 'vitest';
import type {
  DeployList,
  DoltNomsTrend,
  MaintainerTriage,
  RunLane,
  RunSummary,
  SystemHealth,
  TriageItem,
} from 'gas-city-dashboard-shared';
import type {
  AgentResponse,
  Bead,
  FormulaFeedBody,
  HealthOutputBody,
  Message,
  TypedEventStreamEnvelope,
} from '../generated/gc-supervisor-client/types.gen';
import { ATTENTION_DOMAINS, composeAttention } from './compose';
import { createAttentionContributors, type AgentsAttentionFacts } from './registry';

describe('createAttentionContributors', () => {
  it('registers an explicit contributor for every first-class attention domain', () => {
    const contributors = createAttentionContributors();

    expect(contributors.map((c) => c.domain)).toEqual(ATTENTION_DOMAINS);
    expect(new Set(contributors.map((c) => c.id)).size).toBe(ATTENTION_DOMAINS.length);
  });

  it('derives health attention from supervisor reachability and critical host pressure', () => {
    const model = composeAttention(createAttentionContributors({
      health: {
        system: systemHealth({
          free_mem_bytes: 4,
          total_mem_bytes: 100,
          load_avg_1: 13,
          cpu_count: 8,
        }),
        supervisor: { status: 'unavailable', error: 'connect ECONNREFUSED' },
        trend: healthyTrend(),
      },
    }));

    expect(model.byDomain.health.attention).toBe(3);
    expect(model.byDomain.health.watch).toBe(0);
    expect(model.byDomain.health.items.map((item) => item.id)).toEqual([
      'health:supervisor-unreachable',
      'health:memory-critical',
      'health:load-high',
    ]);
  });

  it('derives health watch items from optional supervisor fields and dolt-noms gaps', () => {
    const model = composeAttention(createAttentionContributors({
      health: {
        system: systemHealth(),
        supervisor: {
          status: 'available',
          data: {
            status: 'ok',
            uptime_sec: 300,
          } satisfies HealthOutputBody,
        },
        trend: {
          available: false,
          samples: [],
          reason: 'store_health_absent',
        } satisfies DoltNomsTrend,
      },
    }));

    expect(model.byDomain.health.attention).toBe(0);
    expect(model.byDomain.health.watch).toBe(3);
    expect(model.byDomain.health.items.map((item) => item.id)).toEqual([
      'health:supervisor-city-missing',
      'health:supervisor-version-missing',
      'health:dolt-noms-unavailable',
    ]);
  });

  it('derives city-wide attention from existing facts for every operational domain', () => {
    const model = composeAttention(createAttentionContributors({
      runs: {
        feed: formulaFeed({
          items: [
            {
              id: 'run-1',
              root_bead_id: 'B-root',
              root_store_ref: 'city:B-root',
              scope_kind: 'city',
              scope_ref: 'test-city',
              started_at: '2026-05-29T20:00:00.000Z',
              status: 'failed',
              target: 'mayor',
              title: 'Review formula output',
              type: 'formula',
              updated_at: '2026-05-29T20:05:00.000Z',
            },
          ],
        }),
      },
      agents: {
        items: [
          agent({
            name: 'reviewer',
            running: true,
            state: 'failed',
          }),
        ],
      },
      beads: {
        items: [
          bead({
            id: 'B-1',
            title: 'Fix broken formula',
            status: 'blocked',
          }),
        ],
      },
      mail: {
        operatorAlias: 'stephanie',
        items: [
          message({
            id: 'M-1',
            subject: 'Need approval',
            read: false,
            to: 'stephanie',
          }),
        ],
      },
      activity: {
        deploys: deploys({
          failed_marker: true,
          items: [],
        }),
      },
      health: {
        system: systemHealth({
          free_mem_bytes: 4,
          total_mem_bytes: 100,
        }),
        supervisor: { status: 'available', data: presentSupervisor() },
        trend: healthyTrend(),
      },
    }));

    expect(model.byDomain.runs.attention).toBe(1);
    expect(model.byDomain.runs.items[0]?.href).toBe('/runs/run-1?scope_kind=city&scope_ref=test-city');
    expect(model.byDomain.agents.attention).toBe(1);
    expect(model.byDomain.beads.attention).toBe(1);
    expect(model.byDomain.mail.attention).toBe(1);
    expect(model.byDomain.activity.attention).toBe(1);
    expect(model.byDomain.health.attention).toBe(1);
  });

  it('still derives run attention from the existing RunSummary health model', () => {
    const model = composeAttention(createAttentionContributors({
      runs: {
        summary: runSummary([
          runLane({
            id: 'run-1',
            title: 'Review formula output',
            phase: 'approval',
            health: {
              phaseConfidence: 'known',
              needsOperator: true,
              thrashingDetected: false,
            },
          }),
        ]),
      },
    }));

    expect(model.byDomain.runs.attention).toBe(1);
    expect(model.byDomain.runs.items[0]?.href).toBe('/runs/run-1');
  });

  it('derives agent attention from pending supervisor interactions', () => {
    const model = composeAttention(createAttentionContributors({
      agents: {
        items: [],
        pendingInteractions: [{
          agentName: 'mayor',
          sessionId: 'gc-2568',
          sessionName: 'mayor',
          pending: {
            kind: 'tool_approval',
            prompt: 'Approve deployment?',
            request_id: 'req-1',
          },
        }],
      } as AgentsAttentionFacts,
    }));

    expect(model.byDomain.agents.attention).toBe(1);
    expect(model.byDomain.agents.items[0]).toMatchObject({
      id: 'agents:mayor:pending:req-1',
      title: 'mayor needs you',
      href: '/agents/mayor',
    });
  });

  it('derives Activity attention and watch items from supervisor event history', () => {
    const model = composeAttention(createAttentionContributors({
      activity: {
        events: [
          supervisorEvent({
            message: 'session crashed while applying patch',
            seq: 42,
            subject: 'gc-session-1',
            type: 'session.crashed',
          }),
          supervisorEvent({
            message: 'event archive rotated',
            payload: {
              prior_archive: '/tmp/events-1.jsonl',
              prior_first_seq: 1,
              prior_last_seq: 40,
            },
            seq: 41,
            subject: 'events',
            type: 'events.rotated',
          }),
        ],
      },
    }));

    expect(model.byDomain.activity.attention).toBe(1);
    expect(model.byDomain.activity.watch).toBe(1);
    expect(model.byDomain.activity.items.map((item) => item.id)).toEqual([
      'activity:event:42:session.crashed',
      'activity:event:41:events.rotated',
    ]);
    expect(model.byDomain.activity.items.map((item) => item.href)).toEqual([
      '/activity?mode=events&type=session.crashed',
      '/activity?mode=events&type=events.rotated',
    ]);
  });

  it('derives stale-threshold attention from agent, bead, and mail timestamps', () => {
    const nowMs = Date.parse('2026-06-01T12:00:00.000Z');
    const model = composeAttention(createAttentionContributors({
      agents: {
        nowMs,
        items: [
          agent({
            name: 'idle-agent',
            running: true,
            session: {
              attached: true,
              last_activity: '2026-06-01T07:30:00.000Z',
              name: 'idle-agent',
            },
          }),
        ],
      },
      beads: {
        nowMs,
        items: [
          bead({
            created_at: '2026-05-29T11:00:00.000Z',
            id: 'B-stale-open',
            status: 'open',
          }),
          bead({
            assignee: 'reviewer',
            created_at: '2026-05-29T11:00:00.000Z',
            id: 'B-stale-assigned',
            status: 'in_progress',
          }),
        ],
      },
      mail: {
        nowMs,
        operatorAlias: 'stephanie',
        items: [
          message({
            created_at: '2026-05-31T08:00:00.000Z',
            id: 'M-stale-unread',
            read: false,
            subject: 'Still waiting',
            to: 'stephanie',
          }),
        ],
      },
    }));

    expect(model.byDomain.agents.items.map((item) => item.id)).toContain(
      'agents:idle-agent:stale-idle',
    );
    expect(model.byDomain.beads.items.map((item) => item.id)).toEqual([
      'beads:B-stale-open:stale-unclaimed',
      'beads:B-stale-assigned:stale-assigned',
    ]);
    expect(model.byDomain.beads.items.map((item) => item.href)).toEqual([
      '/beads?bead=B-stale-open',
      '/beads?bead=B-stale-assigned',
    ]);
    expect(model.byDomain.mail.items.map((item) => item.id)).toContain(
      'mail:M-stale-unread:unread-stale',
    );
    expect(model.byDomain.mail.items.map((item) => item.href)).toContain(
      '/mail?message=M-stale-unread',
    );
  });

  it('derives maintainer attention from needs-you, awaiting-triage, and blocked slung facts', () => {
    const nowMs = Date.parse('2026-06-01T12:00:00.000Z');
    const model = composeAttention(createAttentionContributors({
      maintainer: {
        nowMs,
        triage: maintainerTriage({
          items: [
            triageItem({
              kind: 'pr',
              number: 101,
              status: 'changes_requested',
              title: 'review feedback needs operator',
            }),
            triageItem({
              kind: 'issue',
              number: 102,
              status: 'open',
              title: 'new bug needs triage',
              updated_at: '2026-06-01T11:00:00.000Z',
            }),
          ],
          slung: [
            triageItem({
              kind: 'pr',
              number: 103,
              status: 'open',
              title: 'slung item has no live session',
              slung: {
                bead_id: 'gc-103',
                resolved_session_name: null,
                slung_at: '2026-06-01T10:00:00.000Z',
                target: 'triage-agent',
              },
            }),
          ],
        }),
      },
    }));

    expect(model.byDomain.maintainer.attention).toBe(3);
    expect(model.byDomain.maintainer.items.map((item) => item.id)).toEqual([
      'maintainer:pr-101:needs-you',
      'maintainer:issue-102:needs-triage',
      'maintainer:pr-103:slung-unresolved',
    ]);
    expect(model.byDomain.maintainer.items.map((item) => item.href)).toEqual([
      '/maintainer?view=needs-you',
      '/maintainer',
      '/maintainer',
    ]);
  });
});

function systemHealth(overrides: Partial<SystemHealth['host']> = {}): SystemHealth {
  return {
    admin: {
      pid: 123,
      uptime_sec: 600,
      rss_bytes: 128_000_000,
      heap_used_bytes: 64_000_000,
      node_version: 'v22.0.0',
    },
    host: {
      load_avg_1: 0.5,
      load_avg_5: 0.4,
      load_avg_15: 0.3,
      total_mem_bytes: 100,
      free_mem_bytes: 50,
      cpu_count: 8,
      uptime_sec: 86_400,
      ...overrides,
    },
  };
}

function healthyTrend(): DoltNomsTrend {
  return {
    available: true,
    samples: [],
    source: 'supervisor',
  };
}

function presentSupervisor(): HealthOutputBody {
  return {
    city: 'test-city',
    status: 'ok',
    uptime_sec: 300,
    version: '1.0.0',
  };
}

function supervisorEvent(
  overrides: Partial<TypedEventStreamEnvelope>,
): TypedEventStreamEnvelope {
  return {
    actor: 'supervisor',
    message: 'event message',
    payload: {
      reason: 'panic',
      session_id: 'gc-session-1',
      template: 'mayor',
    },
    seq: 1,
    subject: 'gc-session-1',
    ts: '2026-06-01T10:10:00.000Z',
    type: 'session.crashed',
    ...overrides,
  } as TypedEventStreamEnvelope;
}

function runSummary(lanes: readonly RunLane[]): RunSummary {
  const byPhase: Record<RunLane['phase'], number> = {
    active: 0,
    approval: 0,
    blocked: 0,
    complete: 0,
    finalization: 0,
    implementation: 0,
    intake: 0,
    review: 0,
  };
  for (const lane of lanes) {
    byPhase[lane.phase] += 1;
  }
  return {
    lanes: [...lanes],
    historicalLanes: [],
    totalActive: lanes.length,
    totalHistorical: 0,
    runCounts: {
      total: lanes.length,
      visible: lanes.length,
      prReview: 0,
      designReview: 0,
      bugfix: 0,
      blocked: lanes.filter((lane) => lane.phase === 'blocked').length,
      other: 0,
    },
    recentChanges: [],
    census: {
      status: 'available',
      data: {
        byPhase,
        totalInFlight: lanes.length,
        unverifiable: 0,
        knownDenominator: lanes.length,
        thrashing: 0,
      },
    },
  };
}

function runLane({
  id,
  title,
  phase,
  health,
}: {
  id: string;
  title: string;
  phase: RunLane['phase'];
  health: {
    phaseConfidence: 'known' | 'inferred';
    needsOperator: boolean;
    thrashingDetected: boolean;
  };
}): RunLane {
  return {
    id,
    title,
    phase,
    phaseLabel: phase,
    health: {
      status: 'available',
      data: {
        ...health,
        stuckNode: { status: 'unavailable', error: 'no active step' },
        session: {
          status: 'unresolved',
          error: 'no session',
        },
      },
    },
  } as RunLane;
}

function agent(overrides: Partial<AgentResponse>): AgentResponse {
  return {
    available: true,
    name: 'agent',
    running: false,
    state: 'active',
    suspended: false,
    ...overrides,
  };
}

function bead(overrides: Partial<Bead>): Bead {
  return {
    created_at: '2026-05-29T20:00:00.000Z',
    id: 'B-0',
    issue_type: 'task',
    status: 'open',
    title: 'Bead',
    ...overrides,
  };
}

function message(overrides: Partial<Message>): Message {
  return {
    body: '',
    created_at: '2026-05-29T20:00:00.000Z',
    from: 'sam',
    id: 'M-0',
    read: true,
    subject: 'Message',
    to: 'stephanie',
    ...overrides,
  };
}

function deploys(overrides: Partial<DeployList>): DeployList {
  return {
    failed_marker: false,
    items: [],
    source: null,
    ...overrides,
  };
}

function formulaFeed(overrides: Partial<FormulaFeedBody>): FormulaFeedBody {
  return {
    items: [],
    partial: false,
    ...overrides,
  };
}

function maintainerTriage({
  items = [],
  slung = [],
}: {
  items?: readonly TriageItem[];
  slung?: readonly TriageItem[];
} = {}): MaintainerTriage {
  return {
    computed_at: '2026-06-01T12:00:00.000Z',
    repo: 'gastownhall/gascity',
    slung_section: [...slung],
    tiers: [
      { tier: 'regression_breaking', clusters: [], unclustered: [...items] },
      { tier: 'regression', clusters: [], unclustered: [] },
      { tier: 'stability', clusters: [], unclustered: [] },
    ],
    totals: {
      issues_open: items.filter((item) => item.kind === 'issue').length,
      prs_open: items.filter((item) => item.kind === 'pr').length,
    },
  };
}

function triageItem(
  overrides: Partial<TriageItem> & {
    kind: TriageItem['kind'];
    number: number;
    status: TriageItem['status'];
  },
): TriageItem {
  const { kind, number, status, ...rest } = overrides;
  return {
    author: {
      computed_at: null,
      issues_accepted: null,
      issues_opened: null,
      login: 'contributor',
      prs_merged: null,
      prs_opened: null,
      tier: 'trusted',
    },
    blast_files: [],
    cluster_id: null,
    created_at: '2026-06-01T09:00:00.000Z',
    has_in_flight_pr: false,
    html_url: `https://github.com/gastownhall/gascity/${kind === 'pr' ? 'pull' : 'issues'}/${number}`,
    is_marked: false,
    kind,
    labels: [],
    lines_changed: null,
    linked_numbers: [],
    number,
    slung: null,
    status,
    tier: 'regression_breaking',
    title: `item ${number}`,
    triage_assessment: null,
    triage_score: 200,
    updated_at: '2026-06-01T09:30:00.000Z',
    weak_ties: [],
    ...rest,
  };
}

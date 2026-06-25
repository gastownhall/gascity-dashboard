import { describe, expect, it } from 'vitest';
import { selectOperatorActionableUnread } from 'gas-city-dashboard-shared';
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
  HealthOutputBody,
  Message,
  TypedEventStreamEnvelope,
} from 'gas-city-dashboard-shared/gc-supervisor';
import {
  selectAgentsNeedingYou,
  selectBlockedRuns,
  selectStrandedRuns,
} from 'gas-city-dashboard-shared';
import { ATTENTION_DOMAINS, composeAttention } from './compose';
import { createAttentionContributors, type AgentsAttentionFacts } from './registry';

// The mayor-decision marker label now flows through BeadsAttentionFacts from
// runtime config (gascity-dashboard-bhvn) instead of a shared constant.
const NEEDS_STEPHANIE_LABEL = 'needs/stephanie';

describe('createAttentionContributors', () => {
  it('registers an explicit contributor for every first-class attention domain', () => {
    const contributors = createAttentionContributors();

    expect(contributors.map((c) => c.domain)).toEqual(ATTENTION_DOMAINS);
    expect(new Set(contributors.map((c) => c.id)).size).toBe(ATTENTION_DOMAINS.length);
  });

  it('threads each facts read-freshness onto its contributor and folds it per domain (gascity-dashboard-5t0m)', () => {
    // A calm domain (agents facts present, no alerting items) must still carry
    // its read age into byDomain — the spine's whole point.
    const model = composeAttention(
      createAttentionContributors({
        agents: { items: [], provenance: 'stale', fetchedAt: '2026-06-18T09:00:00.000Z' },
        beads: {
          decisionLabel: 'needs/stephanie',
          provenance: 'error',
          fetchedAt: '2026-06-18T08:00:00.000Z',
        },
      }),
    );

    expect(model.byDomain.agents.severity).toBeNull();
    expect(model.byDomain.agents.provenance).toBe('stale');
    expect(model.byDomain.agents.fetchedAt).toBe('2026-06-18T09:00:00.000Z');
    expect(model.byDomain.beads.provenance).toBe('error');
    // A domain with no facts at all reports no freshness.
    expect(model.byDomain.maintainer.provenance).toBeUndefined();
    expect(model.byDomain.maintainer.fetchedAt).toBeUndefined();
  });

  it('derives health attention from supervisor reachability and critical host pressure', () => {
    const model = composeAttention(
      createAttentionContributors({
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
      }),
    );

    expect(model.byDomain.health.attention).toBe(3);
    expect(model.byDomain.health.watch).toBe(0);
    expect(model.byDomain.health.items.map((item) => item.id)).toEqual([
      'health:supervisor-unreachable',
      'health:memory-critical',
      'health:load-high',
    ]);
  });

  it('derives health watch items from optional supervisor fields and dolt-noms gaps', () => {
    const model = composeAttention(
      createAttentionContributors({
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
      }),
    );

    expect(model.byDomain.health.attention).toBe(0);
    expect(model.byDomain.health.watch).toBe(3);
    expect(model.byDomain.health.items.map((item) => item.id)).toEqual([
      'health:supervisor-city-missing',
      'health:supervisor-version-missing',
      'health:dolt-noms-unavailable',
    ]);
  });

  it('derives dashboard-process attention from local admin process metrics', () => {
    const model = composeAttention(
      createAttentionContributors({
        health: {
          system: systemHealth(
            {},
            {
              heap_used_bytes: 1_400_000_000,
              rss_bytes: 2_200_000_000,
              uptime_sec: 8,
            },
          ),
          supervisor: { status: 'available', data: presentSupervisor() },
          trend: healthyTrend(),
        },
      }),
    );

    expect(model.byDomain.health.attention).toBe(3);
    expect(model.byDomain.health.items.map((item) => item.id)).toEqual([
      'health:dashboard-process-starting',
      'health:dashboard-process-rss-high',
      'health:dashboard-process-heap-high',
    ]);
  });

  it('derives city-wide attention from existing facts for every operational domain', () => {
    const model = composeAttention(
      createAttentionContributors({
        runs: {
          summary: runSummary([
            runLane({
              id: 'run-1',
              title: 'Review formula output',
              phase: 'blocked',
              scope: {
                status: 'available',
                kind: 'city',
                ref: 'test-city',
                rootStoreRef: 'city:test-city',
              },
              statusCounts: { blocked: 1 },
              health: { phaseConfidence: 'known', needsOperator: true, thrashingDetected: false },
            }),
          ]),
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
          decisionLabel: NEEDS_STEPHANIE_LABEL,
          escalations: [
            bead({
              id: 'B-1',
              title: 'Fix broken formula',
              status: 'blocked',
              labels: ['gc:escalation'],
            }),
          ],
        },
        mail: {
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
      }),
    );

    expect(model.byDomain.runs.attention).toBe(1);
    expect(model.byDomain.runs.items[0]?.href).toBe(
      '/runs/run-1?scope_kind=city&scope_ref=test-city',
    );
    expect(model.byDomain.agents.attention).toBe(1);
    expect(model.byDomain.beads.attention).toBe(1);
    expect(model.byDomain.mail.attention).toBe(1);
    expect(model.byDomain.activity.attention).toBe(1);
    expect(model.byDomain.health.attention).toBe(1);
  });

  it('counts genuinely-blocked runs only — a needs-operator active lane does not count (gascity-dashboard-2j8e.2)', () => {
    const model = composeAttention(
      createAttentionContributors({
        runs: {
          summary: runSummary([
            runLane({
              id: 'active-1',
              title: 'Active needs operator',
              phase: 'approval',
              health: { phaseConfidence: 'known', needsOperator: true, thrashingDetected: false },
            }),
            runLane({
              id: 'blocked-1',
              title: 'Stuck run',
              phase: 'blocked',
              statusCounts: { blocked: 1 },
              health: { phaseConfidence: 'known', needsOperator: true, thrashingDetected: false },
            }),
          ]),
        },
      }),
    );

    expect(model.byDomain.runs.attention).toBe(1);
    expect(model.byDomain.runs.watch).toBe(0);
    expect(model.byDomain.runs.items.map((item) => item.id)).toEqual(['runs:blocked-1:blocked']);
    expect(model.byDomain.runs.items[0]?.href).toBe('/runs/blocked-1');
  });

  it('emits a counting attention item for a stranded run (gascity-dashboard-pxvb)', () => {
    const summary = runSummary([
      runLane({
        id: 'gc-odssky',
        title: 'mol-pr-start: gascity issue #3192',
        phase: 'intake',
        registration: 'stranded',
        health: { phaseConfidence: 'known', needsOperator: false, thrashingDetected: false },
      }),
      runLane({
        id: 'active-1',
        title: 'Healthy active run',
        phase: 'implementation',
        health: { phaseConfidence: 'known', needsOperator: false, thrashingDetected: false },
      }),
    ]);

    const model = composeAttention(createAttentionContributors({ runs: { summary } }));

    // The stranded run is the only operator-actionable runs item — a healthy
    // active lane never counts. The badge number, the page Stranded CountTile,
    // and the Stranded section header read one selector and must agree.
    expect(model.byDomain.runs.attention).toBe(1);
    expect(model.byDomain.runs.items.map((item) => item.id)).toEqual(['runs:gc-odssky:stranded']);
    expect(model.byDomain.runs.items[0]?.href).toBe('/runs/gc-odssky');
    expect(summary.runCounts.stranded).toBe(1);
    expect(selectStrandedRuns(summary.strandedLanes).length).toBe(1);
  });

  it('nav badge count equals the page Blocked count for a mixed summary (gascity-dashboard-2j8e.6)', () => {
    // #95 (2j8e.2) claimed the badge and the /runs page "cannot disagree by
    // construction" but never asserted it. This pins the invariant over ONE
    // summary with a non-trivial mix of phases: the nav badge number
    // (byDomain.runs.attention), the page Blocked CountTile (runCounts.blocked),
    // and the page Blocked section header (selectBlockedRuns(blockedLanes).length)
    // must all be the SAME number. A regression that counts all lanes, or that
    // lets runCounts.blocked drift from the selectBlockedRuns phase filter, fails
    // here instead of silently shipping a mismatched badge.
    const summary = runSummary([
      runLane({
        id: 'blocked-1',
        title: 'First stuck run',
        phase: 'blocked',
        statusCounts: { blocked: 1 },
        health: { phaseConfidence: 'known', needsOperator: true, thrashingDetected: false },
      }),
      runLane({
        id: 'active-1',
        title: 'Healthy active run',
        phase: 'implementation',
        health: { phaseConfidence: 'known', needsOperator: false, thrashingDetected: false },
      }),
      runLane({
        id: 'blocked-2',
        title: 'Second stuck run',
        phase: 'blocked',
        statusCounts: { blocked: 2 },
        health: { phaseConfidence: 'known', needsOperator: true, thrashingDetected: false },
      }),
      runLane({
        id: 'done-1',
        title: 'Finished run',
        phase: 'complete',
        health: { phaseConfidence: 'known', needsOperator: false, thrashingDetected: false },
      }),
    ]);

    const model = composeAttention(createAttentionContributors({ runs: { summary } }));

    const navBadgeCount = model.byDomain.runs.attention;
    const pageBlockedTile = summary.runCounts.blocked;
    const pageBlockedSection = selectBlockedRuns(summary.blockedLanes).length;

    expect(navBadgeCount).toBe(2);
    expect(pageBlockedTile).toBe(navBadgeCount);
    expect(pageBlockedSection).toBe(navBadgeCount);
  });

  it('counts operator needs-you mail only — folds the pool-worker firehose (gascity-dashboard-2j8e.5)', () => {
    const model = composeAttention(
      createAttentionContributors({
        mail: {
          nowMs: Date.parse('2026-06-07T12:00:00.000Z'),
          items: [
            message({
              id: 'M-mayor',
              from: 'mayor',
              subject: 'Decision needed',
              read: false,
              created_at: '2026-06-07T11:00:00.000Z',
            }),
            message({
              id: 'M-pl',
              from: 'zeldascension/oversight-rig.project-lead',
              subject: 'Review escalation',
              read: false,
              created_at: '2026-06-07T10:00:00.000Z',
            }),
            // The worker firehose (the ~93 inflation) — folded out of the badge.
            message({ id: 'M-pc1', from: '/home/ds/gascity/polecat-1', read: false }),
            message({ id: 'M-pc2', from: '/home/ds/gascity/polecat-2', read: false }),
          ],
        },
      }),
    );

    expect(model.byDomain.mail.attention).toBe(2);
    expect(model.byDomain.mail.watch).toBe(0);
    expect(model.byDomain.mail.items.map((item) => item.id)).toEqual([
      'mail:M-mayor:unread',
      'mail:M-pl:unread',
    ]);
    expect(model.byDomain.mail.items.map((item) => item.href)).toEqual([
      '/mail?message=M-mayor',
      '/mail?message=M-pl',
    ]);
  });

  it('Mail badge count equals the Mail page selector count — one selectOperatorActionableUnread (gascity-dashboard-2j8e.5)', () => {
    const items = [
      message({ id: 'A', from: 'mayor', read: false, created_at: '2026-06-07T11:00:00.000Z' }),
      message({ id: 'B', from: '/home/ds/gascity/polecat-1', read: false }),
      message({ id: 'C', from: 'clerk', read: false, created_at: '2026-06-07T11:30:00.000Z' }),
      message({ id: 'D', from: 'mayor', read: true }),
    ];
    const badge = composeAttention(
      createAttentionContributors({
        mail: { items, nowMs: Date.parse('2026-06-07T12:00:00.000Z') },
      }),
    ).byDomain.mail;
    // The Mail page derives its count from the SAME selector, so the two cannot
    // disagree: the polecat firehose (B) and the read message (D) drop, leaving
    // the mayor + clerk escalations.
    const pageCount = selectOperatorActionableUnread(items).length;
    expect(pageCount).toBe(2);
    expect(badge.attention + badge.watch).toBe(pageCount);
  });

  it('never counts a supervisor partial read as a run (gascity-dashboard-2j8e.2)', () => {
    const summary = runSummary([
      runLane({
        id: 'blocked-1',
        title: 'Stuck run',
        phase: 'blocked',
        statusCounts: { blocked: 1 },
        health: { phaseConfidence: 'inferred', needsOperator: false, thrashingDetected: false },
      }),
    ]);
    const model = composeAttention(
      createAttentionContributors({ runs: { summary: { ...summary, lanesPartial: true } } }),
    );

    // The blocked run counts; the partial flag lands only in the non-counting
    // unavailable tier (dash-ygj) — so the badge count is stable across partial
    // fan-outs (no 6<->13 flap) while the degraded read still surfaces quietly.
    expect(model.byDomain.runs.attention).toBe(1);
    expect(model.byDomain.runs.watch).toBe(0);
    expect(model.byDomain.runs.unavailable).toBe(1);
    const ids = model.byDomain.runs.items.map((item) => item.id);
    expect(ids).toContain('runs:blocked-1:blocked');
    expect(ids).toContain('runs:partial');
  });

  it('surfaces a single unavailable item when run data errors (gascity-dashboard-2j8e.2)', () => {
    const model = composeAttention(
      createAttentionContributors({ runs: { error: 'supervisor unreachable' } }),
    );

    expect(model.byDomain.runs.items.map((item) => item.id)).toEqual(['runs:unavailable']);
    expect(model.byDomain.runs.attention).toBe(1);
  });

  it('reclassifies summary-derived runs data-unavailability into the unavailable tier, carrying read freshness', () => {
    const model = composeAttention(
      createAttentionContributors({
        runs: {
          provenance: 'stale',
          fetchedAt: '2026-06-06T12:00:00.000Z',
          summary: {
            ...runSummary([]),
            lanesPartial: true,
            lanes: [healthUnavailableLane('run-health', 'Health run')],
          },
        },
      }),
    );

    // The summary-derived data-unavailability emitters (list-partial,
    // health-unavailable) must never inflate the badge counts… (the formula feed
    // is no longer a runs-attention source — gascity-dashboard-2j8e.2 — so its
    // feed-partial / detail-unavailable emitters are gone with it.)
    expect(model.byDomain.runs.attention).toBe(0);
    expect(model.byDomain.runs.watch).toBe(0);
    // …they land in the dedicated unavailable tier…
    expect(model.byDomain.runs.unavailable).toBe(2);
    // …and never color the nav badge.
    expect(model.byDomain.runs.severity).toBeNull();

    const ids = model.byDomain.runs.items.map((item) => item.id);
    expect(ids).toContain('runs:partial');
    expect(ids).toContain('runs:run-health:health-unavailable');

    for (const item of model.byDomain.runs.items) {
      expect(item.severity).toBe('unavailable');
    }
    // Read freshness is aged via the contributor-level fold on the domain
    // summary (the single source the board liveness line reads), not per item.
    expect(model.byDomain.runs.provenance).toBe('stale');
    expect(model.byDomain.runs.fetchedAt).toBe('2026-06-06T12:00:00.000Z');
  });

  it('keeps a total runs read failure as a loud attention signal, not the quiet unavailable tier', () => {
    const model = composeAttention(
      createAttentionContributors({
        runs: { error: 'formula run feed unavailable', provenance: 'error' },
      }),
    );

    // A complete outage stays attention so the operator is not left blind.
    expect(model.byDomain.runs.attention).toBe(1);
    expect(model.byDomain.runs.unavailable).toBe(0);
    expect(model.byDomain.runs.items[0]?.id).toBe('runs:unavailable');
    // The read-freshness provenance still threads through on the error path —
    // the loud runs:unavailable item does not shadow the 'error' read state the
    // board liveness line folds from byDomain.runs (gascity-dashboard-5t0m).
    expect(model.byDomain.runs.provenance).toBe('error');
  });

  it('counts an agent awaiting an input decision as needs-you', () => {
    const model = composeAttention(
      createAttentionContributors({
        agents: {
          items: [agent({ name: 'mayor', running: true, state: 'active' })],
          pendingInteractions: [
            {
              agentName: 'mayor',
              sessionId: 'gc-2568',
              sessionName: 'mayor',
              pending: {
                kind: 'tool_approval',
                prompt: 'Approve deployment?',
                request_id: 'req-1',
              },
            },
          ],
        } as AgentsAttentionFacts,
      }),
    );

    expect(model.byDomain.agents.attention).toBe(1);
    expect(model.byDomain.agents.items[0]).toMatchObject({
      id: 'agents:mayor:needs-you',
      title: 'mayor awaiting input',
      summary: 'Approve deployment?',
      href: '/agents/mayor',
    });
  });

  it('derives Activity attention and watch items from supervisor event history', () => {
    const model = composeAttention(
      createAttentionContributors({
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
      }),
    );

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

  it('derives stale-threshold attention from bead and mail timestamps', () => {
    const nowMs = Date.parse('2026-06-01T12:00:00.000Z');
    const model = composeAttention(
      createAttentionContributors({
        beads: {
          decisionLabel: NEEDS_STEPHANIE_LABEL,
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
      }),
    );

    // gascity-dashboard-2j8e.3: a long-stale ready-unclaimed open bead surfaces
    // (attention tier); an assigned in-progress bead is working-as-intended and
    // no longer counts (the stale-assigned emitter was removed with the badge
    // redefinition).
    expect(model.byDomain.beads.items.map((item) => item.id)).toEqual([
      'beads:B-stale-open:ready-unclaimed',
    ]);
    expect(model.byDomain.beads.items.map((item) => item.href)).toEqual([
      '/beads?bead=B-stale-open',
    ]);
    expect(model.byDomain.mail.items.map((item) => item.id)).toContain(
      'mail:M-stale-unread:unread-stale',
    );
    expect(model.byDomain.mail.items.map((item) => item.href)).toContain(
      '/mail?message=M-stale-unread',
    );
  });

  it('does not count actively-running, idle, asleep, or suspended agents', () => {
    const model = composeAttention(
      createAttentionContributors({
        agents: {
          items: [
            agent({ name: 'running', running: true, state: 'active', session: liveSession }),
            agent({ name: 'asleep', running: true, state: 'asleep', session: liveSession }),
            agent({ name: 'idle', state: 'idle', session: liveSession }),
            agent({ name: 'suspended', suspended: true, state: 'active', session: liveSession }),
          ],
        },
      }),
    );

    expect(model.byDomain.agents.attention).toBe(0);
    expect(model.byDomain.agents.watch).toBe(0);
    expect(model.byDomain.agents.items).toEqual([]);
  });

  it('counts each needs-you reason and keeps the badge equal to selectAgentsNeedingYou', () => {
    const items = [
      agent({ name: 'mayor', running: true, state: 'active' }),
      agent({ name: 'crashed', state: 'failed' }),
      agent({ name: 'throttled', running: true, state: 'rate-limited' }),
      agent({ name: 'ghost', running: true, state: 'active' }),
      agent({ name: 'calm', running: true, state: 'active', session: liveSession }),
    ];
    const pendingInteractions = [
      {
        agentName: 'mayor',
        sessionId: 'gc-1',
        sessionName: 'mayor',
        pending: { kind: 'tool_approval', prompt: 'Approve?', request_id: 'req-1' },
      },
    ];
    const model = composeAttention(
      createAttentionContributors({
        agents: { items, pendingInteractions } as AgentsAttentionFacts,
      }),
    );

    const needsYou = selectAgentsNeedingYou(
      items,
      pendingInteractions.map((p) => ({ agentName: p.agentName, prompt: p.pending.prompt })),
    );
    // The nav badge counts attention + watch; needs-you is the ONLY agent
    // attention source and it never emits watch, so the badge equals the
    // selector the /agents page renders (count parity).
    expect(needsYou).toHaveLength(4);
    expect(model.byDomain.agents.attention).toBe(needsYou.length);
    expect(model.byDomain.agents.watch).toBe(0);
    expect(model.byDomain.agents.items.map((item) => item.id).sort()).toEqual([
      'agents:crashed:needs-you',
      'agents:ghost:needs-you',
      'agents:mayor:needs-you',
      'agents:throttled:needs-you',
    ]);
  });

  it('reports a roster read failure in the non-counting unavailable tier', () => {
    const model = composeAttention(
      createAttentionContributors({
        agents: { error: 'agent list unavailable' },
      }),
    );

    expect(model.byDomain.agents.attention).toBe(0);
    expect(model.byDomain.agents.watch).toBe(0);
    expect(model.byDomain.agents.unavailable).toBe(1);
    expect(model.byDomain.agents.items[0]?.id).toBe('agents:unavailable');
  });

  it('reports a partial roster in the non-counting unavailable tier', () => {
    const model = composeAttention(
      createAttentionContributors({
        agents: {
          partial: true,
          items: [agent({ name: 'crashed', state: 'failed' })],
        },
      }),
    );

    expect(model.byDomain.agents.attention).toBe(1);
    expect(model.byDomain.agents.unavailable).toBe(1);
    expect(model.byDomain.agents.items.map((item) => item.id)).toEqual([
      'agents:partial',
      'agents:crashed:needs-you',
    ]);
  });

  it('counts ready-unclaimed + escalated beads and excludes plain dependency-blocked (gascity-dashboard-2j8e.3)', () => {
    const nowMs = Date.parse('2026-06-01T12:00:00.000Z');
    const model = composeAttention(
      createAttentionContributors({
        beads: {
          decisionLabel: NEEDS_STEPHANIE_LABEL,
          nowMs,
          items: [
            // ready-unclaimed: open, no assignee, aged past the watch window.
            bead({
              created_at: '2026-05-29T11:00:00.000Z',
              id: 'B-ready',
              status: 'open',
            }),
            // plain dependency-blocked: working-as-intended queuing — excluded.
            bead({
              created_at: '2026-05-29T11:00:00.000Z',
              id: 'B-dep',
              status: 'blocked',
            }),
            // assigned in-progress work — excluded (no longer a bead alert).
            bead({
              assignee: 'reviewer',
              created_at: '2026-05-29T11:00:00.000Z',
              id: 'B-assigned',
              status: 'in_progress',
            }),
          ],
          // abnormally-blocked: an escalation marker — counted immediately, from
          // the dedicated gc:escalation queue (the general list drops gc: labels).
          escalations: [
            bead({
              created_at: '2026-06-01T11:55:00.000Z',
              id: 'B-esc',
              status: 'blocked',
              labels: ['gc:escalation'],
            }),
          ],
        },
      }),
    );

    const ids = model.byDomain.beads.items.map((item) => item.id);
    expect([...ids].sort()).toEqual(['beads:B-esc:escalated', 'beads:B-ready:ready-unclaimed']);
    expect(model.byDomain.beads.attention).toBe(2);
  });

  it('surfaces each open mayor-decision bead as an attention item linked to the bead view', () => {
    const model = composeAttention(
      createAttentionContributors({
        beads: {
          decisionLabel: NEEDS_STEPHANIE_LABEL,
          decisions: [
            bead({
              id: 'dec-nqy',
              title: 'Decide: stale-CHANGES_REQUESTED merge-queue protocol',
              assignee: 'stephanie',
              labels: [NEEDS_STEPHANIE_LABEL],
              updated_at: '2026-06-03T14:18:47.000Z',
              metadata: { 'decision.decide': 'Auto-close or escalate stale CR PRs?' },
            }),
          ],
        },
      }),
    );

    expect(model.byDomain.beads.items).toEqual([
      expect.objectContaining({
        id: 'beads:dec-nqy:mayor-decision',
        domain: 'beads',
        severity: 'attention',
        title: 'Decide: stale-CHANGES_REQUESTED merge-queue protocol',
        summary: 'Auto-close or escalate stale CR PRs?',
        href: '/beads?bead=dec-nqy',
        updatedAt: '2026-06-03T14:18:47.000Z',
      }),
    ]);
  });

  it('renders a mayor-decision with no decision.decide metadata using the title alone', () => {
    const model = composeAttention(
      createAttentionContributors({
        beads: {
          decisionLabel: NEEDS_STEPHANIE_LABEL,
          decisions: [
            bead({
              id: 'dec-rwr',
              title: 'Decide: P0 baseline-honesty-gate halt',
              labels: [NEEDS_STEPHANIE_LABEL],
            }),
          ],
        },
      }),
    );

    const item = model.byDomain.beads.items[0];
    expect(item?.id).toBe('beads:dec-rwr:mayor-decision');
    expect(item?.summary).toBeUndefined();
  });

  it('does not double-surface a marker bead present in the general list', () => {
    const model = composeAttention(
      createAttentionContributors({
        beads: {
          decisionLabel: NEEDS_STEPHANIE_LABEL,
          // Same bead in both the dedicated queue and the capped general list:
          // the isMayorDecision filter in the generic loop is what keeps it from
          // surfacing twice.
          decisions: [
            bead({
              id: 'dec-nqy',
              title: 'Decide: X',
              labels: [NEEDS_STEPHANIE_LABEL],
              priority: 1,
            }),
          ],
          items: [
            bead({
              id: 'dec-nqy',
              title: 'Decide: X',
              labels: [NEEDS_STEPHANIE_LABEL],
              priority: 1,
            }),
          ],
        },
      }),
    );

    expect(model.byDomain.beads.items.map((item) => item.id)).toEqual([
      'beads:dec-nqy:mayor-decision',
    ]);
  });

  it('dedups mayor-decisions sharing a decision.slug, keeping the most recently moved bead', () => {
    const model = composeAttention(
      createAttentionContributors({
        beads: {
          decisionLabel: NEEDS_STEPHANIE_LABEL,
          // The same decision identity re-filed as a second marker bead: one
          // decision = one attention row, and the most recent movement wins.
          decisions: [
            bead({
              id: 'dec-old',
              title: 'Decide: merge-queue protocol',
              labels: [NEEDS_STEPHANIE_LABEL],
              updated_at: '2026-06-03T10:00:00.000Z',
              metadata: { 'decision.slug': 'merge-queue-protocol' },
            }),
            bead({
              id: 'dec-new',
              title: 'Decide: merge-queue protocol (re-filed)',
              labels: [NEEDS_STEPHANIE_LABEL],
              updated_at: '2026-06-04T10:00:00.000Z',
              metadata: { 'decision.slug': 'merge-queue-protocol' },
            }),
          ],
        },
      }),
    );

    expect(model.byDomain.beads.items.map((item) => item.id)).toEqual([
      'beads:dec-new:mayor-decision',
    ]);
  });

  it('keeps mayor-decisions with distinct or absent decision.slug as separate items', () => {
    const model = composeAttention(
      createAttentionContributors({
        beads: {
          decisionLabel: NEEDS_STEPHANIE_LABEL,
          decisions: [
            bead({
              id: 'dec-a',
              labels: [NEEDS_STEPHANIE_LABEL],
              metadata: { 'decision.slug': 'slug-a' },
            }),
            bead({
              id: 'dec-b',
              labels: [NEEDS_STEPHANIE_LABEL],
              metadata: { 'decision.slug': 'slug-b' },
            }),
            // No slug (and a blank slug) — no shared identity to dedup on.
            bead({ id: 'dec-c', labels: [NEEDS_STEPHANIE_LABEL] }),
            bead({
              id: 'dec-d',
              labels: [NEEDS_STEPHANIE_LABEL],
              metadata: { 'decision.slug': '   ' },
            }),
          ],
        },
      }),
    );

    expect(model.byDomain.beads.items.map((item) => item.id)).toEqual([
      'beads:dec-a:mayor-decision',
      'beads:dec-b:mayor-decision',
      'beads:dec-c:mayor-decision',
      'beads:dec-d:mayor-decision',
    ]);
  });

  it('breaks a decision.slug recency tie deterministically by bead id', () => {
    const model = composeAttention(
      createAttentionContributors({
        beads: {
          decisionLabel: NEEDS_STEPHANIE_LABEL,
          decisions: [
            bead({
              id: 'dec-b',
              labels: [NEEDS_STEPHANIE_LABEL],
              updated_at: '2026-06-04T10:00:00.000Z',
              metadata: { 'decision.slug': 'tied' },
            }),
            bead({
              id: 'dec-a',
              labels: [NEEDS_STEPHANIE_LABEL],
              updated_at: '2026-06-04T10:00:00.000Z',
              metadata: { 'decision.slug': 'tied' },
            }),
          ],
        },
      }),
    );

    expect(model.byDomain.beads.items.map((item) => item.id)).toEqual([
      'beads:dec-a:mayor-decision',
    ]);
  });

  it('surfaces a decision-queue fetch failure without blanking generic bead alerts', () => {
    const model = composeAttention(
      createAttentionContributors({
        beads: {
          decisionLabel: NEEDS_STEPHANIE_LABEL,
          decisionsError: 'decision queue unavailable: ECONNREFUSED',
          escalations: [
            bead({
              id: 'B-1',
              title: 'Fix broken formula',
              status: 'blocked',
              labels: ['gc:escalation'],
            }),
          ],
        },
      }),
    );

    const ids = model.byDomain.beads.items.map((item) => item.id);
    expect(ids).toContain('beads:decisions-unavailable');
    expect(ids).toContain('beads:B-1:escalated');
    // gascity-dashboard-m1gi: the failed decision-queue READ rides the
    // non-counting unavailable tier; only the real escalation inflates the badge.
    expect(model.byDomain.beads.attention).toBe(1);
    expect(model.byDomain.beads.unavailable).toBe(1);
  });

  it('keeps a beads-list read failure in the non-counting unavailable tier — a 503 does not inflate the badge (gascity-dashboard-m1gi)', () => {
    const model = composeAttention(
      createAttentionContributors({
        beads: { decisionLabel: NEEDS_STEPHANIE_LABEL, error: 'bead list unavailable: 503' },
      }),
    );

    expect(model.byDomain.beads.attention).toBe(0);
    expect(model.byDomain.beads.watch).toBe(0);
    expect(model.byDomain.beads.unavailable).toBe(1);
    expect(model.byDomain.beads.severity).toBeNull();
    expect(model.byDomain.beads.items[0]?.id).toBe('beads:unavailable');
  });

  it('keeps an escalation-queue read failure in the non-counting unavailable tier (gascity-dashboard-m1gi)', () => {
    const model = composeAttention(
      createAttentionContributors({
        beads: {
          decisionLabel: NEEDS_STEPHANIE_LABEL,
          escalationsError: 'escalation queue unavailable: ECONNREFUSED',
        },
      }),
    );

    expect(model.byDomain.beads.attention).toBe(0);
    expect(model.byDomain.beads.unavailable).toBe(1);
    expect(model.byDomain.beads.severity).toBeNull();
    expect(model.byDomain.beads.items[0]?.id).toBe('beads:escalations-unavailable');
  });

  it('keeps a mail read failure in the non-counting unavailable tier — a 503 does not inflate the badge (gascity-dashboard-m1gi)', () => {
    const model = composeAttention(
      createAttentionContributors({ mail: { error: 'mail unavailable: 503' } }),
    );

    expect(model.byDomain.mail.attention).toBe(0);
    expect(model.byDomain.mail.watch).toBe(0);
    expect(model.byDomain.mail.unavailable).toBe(1);
    expect(model.byDomain.mail.severity).toBeNull();
    expect(model.byDomain.mail.items[0]?.id).toBe('mail:unavailable');
  });

  it('derives maintainer attention from needs-you, awaiting-triage, and blocked slung facts', () => {
    const nowMs = Date.parse('2026-06-01T12:00:00.000Z');
    const model = composeAttention(
      createAttentionContributors({
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
      }),
    );

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

function systemHealth(
  overrides: Partial<SystemHealth['host']> = {},
  adminOverrides: Partial<SystemHealth['admin']> = {},
): SystemHealth {
  return {
    admin: {
      pid: 123,
      uptime_sec: 600,
      rss_bytes: 128_000_000,
      heap_used_bytes: 64_000_000,
      node_version: 'v22.0.0',
      ...adminOverrides,
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

function supervisorEvent(overrides: Partial<TypedEventStreamEnvelope>): TypedEventStreamEnvelope {
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
  const strandedLanes = lanes.filter(
    (lane) => lane.registration === 'stranded' && lane.phase !== 'complete',
  );
  const blockedLanes = lanes.filter(
    (lane) => lane.phase === 'blocked' && lane.registration !== 'stranded',
  );
  const activeLanes = lanes.filter(
    (lane) =>
      lane.phase !== 'blocked' && lane.phase !== 'complete' && lane.registration !== 'stranded',
  );
  return {
    lanes: activeLanes,
    blockedLanes,
    strandedLanes,
    totalActive: activeLanes.length,
    runCounts: {
      total: activeLanes.length,
      prReview: 0,
      designReview: 0,
      bugfix: 0,
      blocked: blockedLanes.length,
      stranded: strandedLanes.length,
      other: 0,
    },
    recentChanges: [],
    census: {
      status: 'available',
      // gascity-dashboard-pxvb: the production census excludes stranded lanes
      // from the in-flight count (they never executed), so mirror that here —
      // only active + blocked are in flight.
      data: {
        byPhase,
        totalInFlight: activeLanes.length + blockedLanes.length,
        unverifiable: 0,
        knownDenominator: activeLanes.length + blockedLanes.length,
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
  scope,
  statusCounts = {},
  activeAssignees = [],
  registration,
}: {
  id: string;
  title: string;
  phase: RunLane['phase'];
  health: {
    phaseConfidence: 'known' | 'inferred';
    needsOperator: boolean;
    thrashingDetected: boolean;
  };
  scope?: RunLane['scope'];
  statusCounts?: Record<string, number>;
  activeAssignees?: string[];
  registration?: RunLane['registration'];
}): RunLane {
  return {
    id,
    title,
    phase,
    phaseLabel: phase,
    formula: { status: 'known', name: 'mol-test' },
    scope: scope ?? { status: 'unavailable', error: 'run scope metadata unavailable' },
    external: { status: 'unavailable', error: 'external reference unavailable' },
    statusCounts,
    activeAssignees,
    updatedAt: { status: 'available', at: '2026-05-29T20:00:00.000Z' },
    stages: [],
    progress: { status: 'unavailable', error: 'run progress unavailable' },
    formulaStageResolved: false,
    registration: registration ?? 'unknown',
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
  };
}

function healthUnavailableLane(id: string, title: string): RunLane {
  return {
    id,
    title,
    phase: 'active',
    phaseLabel: 'active',
    scope: { status: 'unavailable', error: 'run scope metadata unavailable' },
    health: { status: 'unavailable', error: 'health probe failed' },
  } as RunLane;
}

const liveSession = { attached: true, last_activity: '2026-06-01T11:59:00.000Z', name: 'agent' };

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

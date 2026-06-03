import type { ReactNode } from 'react';
import type {
  DoltNomsTrend,
  LocalToolVersion,
  LocalToolVersions,
  SystemHealth,
} from 'gas-city-dashboard-shared';
import { api } from '../api/client';
import { getActiveCity } from '../api/cityBase';
import { useAttentionModel } from '../attention/context';
import {
  attentionSectionProps,
  prefixedAttentionSeverity,
} from '../attention/routeHighlight';
import { Button } from '../components/Button';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge, type StatusTone } from '../components/StatusBadge';
import type {
  HealthOutputBody,
  StatusBody,
  StatusStoreHealth,
  StatusWorkCounts,
} from '../generated/gc-supervisor-client/types.gen';
import { useCachedData } from '../hooks/useCachedData';
import { useVisibleRefresh } from '../hooks/useVisibleRefresh';
import { formatHumanSize } from '../lib/format';
import { formatShortDate } from '../hooks/time';
import { supervisorApi } from '../supervisor/client';

// Health page fetches the two slow paths in parallel through the
// stale-while-revalidate cache so re-entering this view (or polling
// every 30s) doesn't blank the page first.
async function fetchHealthBundle(): Promise<{
  health: SystemHealth;
  supervisor: SupervisorHealthState;
  status: SupervisorStatusState;
  localTools: LocalToolVersionsState;
  trend: DoltNomsTrend;
}> {
  const [health, supervisor, status, localTools, trend] = await Promise.all([
    api.systemHealth(),
    fetchSupervisorHealth(),
    fetchSupervisorStatus(),
    fetchLocalToolVersions(),
    api.doltTrend(),
  ]);
  return { health, supervisor, status, localTools, trend };
}

export function HealthPage() {
  const attention = useAttentionModel();
  const { data, loading, error, refresh } = useCachedData(
    'health',
    fetchHealthBundle,
  );
  const health = data?.health ?? null;
  const supervisor = data?.supervisor ?? null;
  const status = data?.status ?? null;
  const localTools = data?.localTools ?? null;
  const trend = data?.trend ?? null;
  const hostHealthStatus = health ? hostStatus(health) : undefined;
  const supervisorAttention = prefixedAttentionSeverity(attention, 'health', ['health:supervisor-']);
  const hostAttention = prefixedAttentionSeverity(attention, 'health', [
    'health:load-',
    'health:memory-',
  ]);
  const adminAttention = prefixedAttentionSeverity(attention, 'health', ['health:dashboard-']);
  const doltNomsAttention = prefixedAttentionSeverity(attention, 'health', ['health:dolt-noms-']);

  useVisibleRefresh(refresh, 30_000);

  return (
    <section>
      <PageHeader
        title="Health"
        synopsis={health && supervisor ? buildSynopsis(health, supervisor) : 'Reading state from the supervisor.'}
        meta={
          <>
            {error && (
              <span className="normal-case text-body text-accent" role="alert">
                {error}
              </span>
            )}
            <Button size="sm" onClick={() => void refresh()} disabled={loading}>
              {loading ? 'Refreshing' : 'Refresh'}
            </Button>
          </>
        }
      />

      {health ? (
        <div className="space-y-12">
          <Section
            title="Supervisor"
            attention={supervisorAttention}
            {...(supervisor ? { status: supervisorStatus(supervisor) } : {})}
          >
            {supervisor?.status === 'available' ? (
              <KvList>
                {/* izgc F7/F8: city + version are optional per supervisor's
                    OpenAPI. Absence is itself a wire-drift signal — render
                    in 'warn' tone rather than coalescing to a glanceable
                    em-dash, so the operator notices the regression. */}
                {supervisor.data.city !== undefined ? (
                  <Kv label="City" value={supervisor.data.city} />
                ) : (
                  <Kv label="City" value="not reported by supervisor" tone="warn" />
                )}
                {supervisor.data.version !== undefined ? (
                  <Kv label="Version" value={supervisor.data.version} />
                ) : (
                  <Kv label="Version" value="not reported by supervisor" tone="warn" />
                )}
                <Kv label="Uptime" value={formatDuration(supervisor.data.uptime_sec)} />
                <Kv label="Status" value={supervisor.data.status} />
              </KvList>
            ) : (
              <p className="text-body text-accent">
                Supervisor not reachable. The dashboard shell stays up; live data is stale.
              </p>
            )}
          </Section>

          <Section
            title="Host"
            attention={hostAttention}
            {...(hostHealthStatus ? { status: hostHealthStatus } : {})}
          >
            <KvList>
              <Kv label="CPUs" value={health.host.cpu_count.toString()} />
              <Kv
                label="Load (1m, 5m, 15m)"
                value={`${health.host.load_avg_1.toFixed(2)}, ${health.host.load_avg_5.toFixed(2)}, ${health.host.load_avg_15.toFixed(2)}`}
                {...(health.host.load_avg_1 > health.host.cpu_count
                  ? { tone: 'warn' as const }
                  : {})}
              />
              <Kv
                label="Memory free"
                value={`${formatHumanSize(health.host.free_mem_bytes)} of ${formatHumanSize(health.host.total_mem_bytes)}`}
                {...(health.host.free_mem_bytes / health.host.total_mem_bytes < 0.1
                  ? { tone: 'warn' as const }
                  : {})}
              />
              <Kv label="Host uptime" value={formatDuration(health.host.uptime_sec)} />
            </KvList>
          </Section>

          <Section title="Admin process" attention={adminAttention}>
            <KvList>
              <Kv label="PID" value={health.admin.pid.toString()} />
              <Kv label="Uptime" value={formatDuration(health.admin.uptime_sec)} />
              <Kv label="RSS" value={formatHumanSize(health.admin.rss_bytes)} />
              <Kv label="Heap used" value={formatHumanSize(health.admin.heap_used_bytes)} />
              <Kv label="Node" value={health.admin.node_version} />
            </KvList>
          </Section>

          <Section title="Diagnostics">
            <div className="space-y-8">
              <KvList>
                <LocalToolKv
                  label="Dolt version"
                  datum={localTools?.status === 'available' ? localTools.data.dolt : null}
                  fallbackReason={
                    localTools?.status === 'unavailable'
                      ? localTools.error
                      : 'local tool versions still loading'
                  }
                />
                <LocalToolKv
                  label="Beads version"
                  datum={localTools?.status === 'available' ? localTools.data.beads : null}
                  fallbackReason={
                    localTools?.status === 'unavailable'
                      ? localTools.error
                      : 'local tool versions still loading'
                  }
                />
              </KvList>
              <DoltUsageBlock usage={doltUsageOf(status)} />
              <BeadsUsageBlock usage={beadsUsageOf(status)} />
            </div>
          </Section>

          <Section title="Recommended vs loaded">
            <ConfigComparison comparison={configComparisonOf(status)} />
          </Section>

          <Section
            title="Dolt-noms · 24 h"
            attention={doltNomsAttention}
            meta={trend && trend.samples.length > 0 ? `${trend.samples.length} samples` : undefined}
          >
            {trend === null ? (
              <p className="text-body text-fg-muted italic">Loading.</p>
            ) : !trend.available ? (
              <p className="text-body text-fg-muted italic">
                Dolt-noms metric unavailable: {doltUnavailableCopy(trend.reason)}.
              </p>
            ) : trend.samples.length === 0 ? (
              <p className="text-body text-fg-muted italic">
                No samples yet. Backend just started; next sample in ten minutes or less.
              </p>
            ) : (
              <Sparkline samples={trend.samples} />
            )}
          </Section>
        </div>
      ) : (
        <p className="text-body text-fg-muted italic">Loading.</p>
      )}
    </section>
  );
}

function Section({
  title,
  status,
  meta,
  attention,
  children,
}: {
  title: string;
  status?: { tone: StatusTone; label: string };
  meta?: ReactNode;
  attention?: ReturnType<typeof prefixedAttentionSeverity>;
  children: ReactNode;
}) {
  return (
    <section {...attentionSectionProps(attention ?? null)}>
      <header className="flex items-baseline justify-between gap-4 mb-4 pb-2 border-b border-rule">
        <h2 className="text-headline font-semibold text-fg">{title}</h2>
        <div className="flex items-baseline gap-4">
          {meta && (
            <span className="text-label uppercase tracking-wider text-fg-muted">{meta}</span>
          )}
          {status && <StatusBadge tone={status.tone} label={status.label} />}
        </div>
      </header>
      {children}
    </section>
  );
}

function KvList({ children }: { children: ReactNode }) {
  // Two-column typeset list. Label left, value right, hairlines
  // between rows. Tabular numerals for value alignment.
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-8 gap-y-3 max-w-prose">
      {children}
    </dl>
  );
}

function Kv({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'warn' | 'stuck';
}) {
  const valueColor =
    tone === 'warn' ? 'text-warn' : tone === 'stuck' ? 'text-accent' : 'text-fg';
  return (
    <>
      <dt className="text-body text-fg-muted">{label}</dt>
      <dd className={`text-body tnum font-medium ${valueColor}`}>{value}</dd>
    </>
  );
}

type DiagnosticDatum<T> =
  | { status: 'available'; value: T; source: string }
  | { status: 'unavailable'; reason: string };

interface ConfigComparisonRow {
  label: string;
  recommended: string;
  loaded: string;
  withinRecommendation: boolean;
}

function LocalToolKv({
  label,
  datum,
  fallbackReason,
}: {
  label: string;
  datum: LocalToolVersion | null;
  fallbackReason: string;
}) {
  if (datum === null) {
    return <Kv label={label} value={`unavailable - ${fallbackReason}`} tone="warn" />;
  }
  return datum.status === 'available' ? (
    <Kv label={label} value={datum.version} />
  ) : (
    <Kv label={label} value={`unavailable - ${datum.reason}`} tone="warn" />
  );
}

function DoltUsageBlock({
  usage,
}: {
  usage: DiagnosticDatum<StatusStoreHealth>;
}) {
  if (usage.status === 'unavailable') {
    return <UnavailableNote heading="Dolt usage" reason={usage.reason} />;
  }
  const u = usage.value;
  return (
    <div className="space-y-2">
      <h3 className="text-label uppercase tracking-wider text-fg-muted">Dolt usage</h3>
      <KvList>
        <Kv label="On-disk size" value={formatHumanSize(statusNumber(u.size_bytes))} />
        <Kv label="Live rows" value={u.live_rows.toLocaleString()} />
        <Kv label="MB per row" value={u.ratio_mb_per_row.toString()} />
        <Kv
          label="Last maintenance"
          value={u.last_gc_status ?? 'not reported'}
          {...(u.last_gc_status !== undefined && u.last_gc_status !== 'success'
            ? { tone: 'warn' as const }
            : {})}
        />
        {u.last_gc_at !== undefined && (
          <Kv label="Last maintenance at" value={formatShortDate(u.last_gc_at)} />
        )}
        <Kv label="Store path" value={u.path} />
      </KvList>
    </div>
  );
}

function BeadsUsageBlock({
  usage,
}: {
  usage: DiagnosticDatum<StatusWorkCounts>;
}) {
  if (usage.status === 'unavailable') {
    return <UnavailableNote heading="Beads usage" reason={usage.reason} />;
  }
  const u = usage.value;
  return (
    <div className="space-y-2">
      <h3 className="text-label uppercase tracking-wider text-fg-muted">Beads usage</h3>
      <KvList>
        <Kv label="Open" value={u.open.toString()} />
        <Kv label="Ready" value={u.ready.toString()} />
        <Kv label="In progress" value={u.in_progress.toString()} />
      </KvList>
    </div>
  );
}

function ConfigComparison({
  comparison,
}: {
  comparison: DiagnosticDatum<ConfigComparisonRow[]>;
}) {
  if (comparison.status === 'unavailable') {
    return (
      <p className="text-body text-fg-muted italic">
        Comparison unavailable: {comparison.reason}.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-[1fr_max-content_max-content] gap-x-8 gap-y-3 max-w-prose">
      <div className="text-label uppercase tracking-wider text-fg-muted">Setting</div>
      <div className="text-label uppercase tracking-wider text-fg-muted text-right">Recommended</div>
      <div className="text-label uppercase tracking-wider text-fg-muted text-right">Loaded</div>
      {comparison.value.map((row) => (
        <ComparisonRow key={row.label} row={row} />
      ))}
    </div>
  );
}

function ComparisonRow({ row }: { row: ConfigComparisonRow }) {
  const tone = row.withinRecommendation ? 'text-fg' : 'text-warn';
  return (
    <div className={`contents ${tone}`} data-comparison-row={row.label}>
      <div className={`text-body ${tone}`}>
        {row.label}
        {!row.withinRecommendation && (
          <span className="text-label uppercase tracking-wider text-warn"> · over</span>
        )}
      </div>
      <div className="text-body tnum text-fg-muted text-right">{row.recommended}</div>
      <div className={`text-body tnum font-medium text-right ${tone}`}>{row.loaded}</div>
    </div>
  );
}

function UnavailableNote({ heading, reason }: { heading: string; reason: string }) {
  return (
    <div className="space-y-2">
      <h3 className="text-label uppercase tracking-wider text-fg-muted">{heading}</h3>
      <p className="text-body text-fg-muted italic">Unavailable: {reason}.</p>
    </div>
  );
}

function Sparkline({ samples }: { samples: { ts: string; bytes: number }[] }) {
  if (samples.length === 0) return null;
  const max = Math.max(...samples.map((s) => s.bytes));
  const min = Math.min(...samples.map((s) => s.bytes));
  const range = max - min || 1;
  const width = 600;
  const height = 60;
  const stepX = samples.length > 1 ? width / (samples.length - 1) : width;
  const points = samples
    .map((s, i) => {
      const x = i * stepX;
      const y = height - ((s.bytes - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <div className="space-y-3 max-w-prose">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="w-full h-16"
        aria-label="24 hour dolt-noms size trend"
      >
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          className="text-accent"
          points={points}
        />
      </svg>
      <div className="flex items-baseline justify-between text-label uppercase tracking-wider text-fg-muted tnum">
        <span>min {formatHumanSize(min)}</span>
        <span>max {formatHumanSize(max)}</span>
      </div>
    </div>
  );
}

function doltUnavailableCopy(
  reason: Extract<DoltNomsTrend, { available: false }>['reason'],
): string {
  switch (reason) {
    case 'store_health_absent':
      return 'supervisor is not reporting store_health; samples resume when it recovers';
    case 'sample_failed':
      return 'latest supervisor status read failed; check the backend log';
  }
}

type SupervisorHealthState =
  | { status: 'available'; data: HealthOutputBody }
  | { status: 'unavailable'; error: string };

type SupervisorStatusState =
  | { status: 'available'; data: StatusBody }
  | { status: 'unavailable'; error: string };

type LocalToolVersionsState =
  | { status: 'available'; data: LocalToolVersions }
  | { status: 'unavailable'; error: string };

async function fetchSupervisorHealth(): Promise<SupervisorHealthState> {
  const cityName = getActiveCity();
  if (cityName === null) {
    throw new Error('Health page loaded before an active city was resolved');
  }
  try {
    return {
      status: 'available',
      data: await supervisorApi().cityHealth(cityName),
    };
  } catch {
    return {
      status: 'unavailable',
      error: 'supervisor health unavailable',
    };
  }
}

async function fetchSupervisorStatus(): Promise<SupervisorStatusState> {
  const cityName = getActiveCity();
  if (cityName === null) {
    throw new Error('Health page loaded before an active city was resolved');
  }
  try {
    return {
      status: 'available',
      data: await supervisorApi().cityStatus(cityName),
    };
  } catch {
    return {
      status: 'unavailable',
      error: 'supervisor status unavailable',
    };
  }
}

async function fetchLocalToolVersions(): Promise<LocalToolVersionsState> {
  try {
    return {
      status: 'available',
      data: await api.localToolVersions(),
    };
  } catch {
    return {
      status: 'unavailable',
      error: 'local tool versions unavailable',
    };
  }
}

function buildSynopsis(h: SystemHealth, supervisorState: SupervisorHealthState): string {
  const parts: string[] = [];
  if (supervisorState.status === 'available') {
    const supervisor = supervisorState.data;
    const verb = supervisor.status === 'ok' ? 'healthy' : supervisor.status;
    // izgc F7/F8: city is optional per OpenAPI. Skip the locator clause if
    // absent rather than rendering "Supervisor healthy on undefined" — the
    // adjacent Kv block surfaces the absence with a warn tone.
    if (supervisor.city !== undefined) {
      parts.push(`Supervisor ${verb} on ${supervisor.city}, uptime ${formatDuration(supervisor.uptime_sec)}.`);
    } else {
      parts.push(`Supervisor ${verb}, uptime ${formatDuration(supervisor.uptime_sec)}.`);
    }
  } else {
    parts.push('Supervisor unreachable.');
  }
  const usedPct = Math.round(
    100 * (1 - h.host.free_mem_bytes / h.host.total_mem_bytes),
  );
  parts.push(
    `Memory at ${usedPct}%; ${h.host.cpu_count} CPUs averaging ${h.host.load_avg_1.toFixed(2)} load.`,
  );
  return parts.join(' ');
}

function supervisorStatus(supervisorState: SupervisorHealthState): { tone: StatusTone; label: string } {
  if (supervisorState.status === 'unavailable') return { tone: 'stuck', label: 'offline' };
  if (supervisorState.data.status === 'ok') return { tone: 'ok', label: 'healthy' };
  return { tone: 'warn', label: supervisorState.data.status };
}

function hostStatus(h: SystemHealth): { tone: StatusTone; label: string } | undefined {
  const memPct = h.host.free_mem_bytes / h.host.total_mem_bytes;
  if (memPct < 0.05) return { tone: 'stuck', label: 'memory critical' };
  if (memPct < 0.10) return { tone: 'warn', label: 'memory low' };
  if (h.host.load_avg_1 > h.host.cpu_count * 1.5) return { tone: 'warn', label: 'load high' };
  return undefined;
}

function doltUsageOf(
  statusState: SupervisorStatusState | null,
): DiagnosticDatum<StatusStoreHealth> {
  if (statusState === null) {
    return { status: 'unavailable', reason: 'supervisor status still loading' };
  }
  if (statusState.status === 'unavailable') {
    return { status: 'unavailable', reason: statusState.error };
  }
  const storeHealth = statusState.data.store_health;
  if (storeHealth === undefined) {
    return {
      status: 'unavailable',
      reason: 'supervisor did not report store_health',
    };
  }
  return {
    status: 'available',
    value: storeHealth,
    source: 'supervisor status.store_health',
  };
}

function beadsUsageOf(
  statusState: SupervisorStatusState | null,
): DiagnosticDatum<StatusWorkCounts> {
  if (statusState === null) {
    return { status: 'unavailable', reason: 'supervisor status still loading' };
  }
  if (statusState.status === 'unavailable') {
    return { status: 'unavailable', reason: statusState.error };
  }
  return {
    status: 'available',
    value: statusState.data.work,
    source: 'supervisor status.work',
  };
}

function configComparisonOf(
  statusState: SupervisorStatusState | null,
): DiagnosticDatum<ConfigComparisonRow[]> {
  const usage = doltUsageOf(statusState);
  if (usage.status === 'unavailable') {
    return { status: 'unavailable', reason: usage.reason };
  }
  const storeHealth = usage.value;
  return {
    status: 'available',
    source: 'supervisor status.store_health (threshold vs actual)',
    value: [{
      label: 'Dolt MB-per-row ratio',
      recommended: `<= ${storeHealth.threshold_mb_per_row}`,
      loaded: String(storeHealth.ratio_mb_per_row),
      withinRecommendation: !storeHealth.warning,
    }],
  };
}

function statusNumber(value: number | bigint): number {
  return typeof value === 'bigint' ? Number(value) : value;
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86_400) return `${Math.round(sec / 3600)}h`;
  const days = Math.floor(sec / 86_400);
  const hours = Math.round((sec % 86_400) / 3600);
  return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
}

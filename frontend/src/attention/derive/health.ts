import type { DoltNomsTrend, SystemHealth } from 'gas-city-dashboard-shared';
import type { HealthOutputBody } from 'gas-city-dashboard-shared/gc-supervisor';
import type { AttentionItem } from '../compose';
import type { ReadFreshnessFacts } from './shared';

export type SupervisorHealthState =
  | { status: 'available'; data: HealthOutputBody }
  | { status: 'unavailable'; error: string };

export interface HealthAttentionFacts extends ReadFreshnessFacts {
  system?: SystemHealth;
  supervisor?: SupervisorHealthState;
  trend?: DoltNomsTrend;
  dashboardError?: string;
}

const DASHBOARD_PROCESS_STARTING_UPTIME_SEC = 30;
const DASHBOARD_PROCESS_RSS_HIGH_BYTES = 2_000_000_000;
const DASHBOARD_PROCESS_RSS_ELEVATED_BYTES = 1_000_000_000;
const DASHBOARD_PROCESS_HEAP_HIGH_BYTES = 1_000_000_000;
const DASHBOARD_PROCESS_HEAP_ELEVATED_BYTES = 512_000_000;

export function deriveHealthAttention(
  facts: HealthAttentionFacts | undefined,
): readonly AttentionItem[] {
  const items: AttentionItem[] = [];
  if (facts === undefined) return items;

  if (facts.dashboardError !== undefined && facts.dashboardError.length > 0) {
    items.push(
      healthAttention({
        id: 'health:dashboard-health-unavailable',
        title: 'Dashboard health unavailable',
        summary: facts.dashboardError,
      }),
    );
  }

  if (facts.supervisor !== undefined) {
    appendSupervisorAttention(items, facts.supervisor);
  }
  if (facts.system !== undefined) {
    appendDashboardProcessAttention(items, facts.system);
    appendHostAttention(items, facts.system);
  }
  if (facts.trend !== undefined && !facts.trend.available) {
    items.push(
      healthWatch({
        id: 'health:dolt-noms-unavailable',
        title: 'Dolt-noms trend unavailable',
        summary: facts.trend.reason,
      }),
    );
  }

  return items;
}

function appendSupervisorAttention(
  items: AttentionItem[],
  supervisor: SupervisorHealthState,
): void {
  if (supervisor.status === 'unavailable') {
    items.push(
      healthAttention({
        id: 'health:supervisor-unreachable',
        title: 'Supervisor unreachable',
        summary: supervisor.error,
      }),
    );
    return;
  }

  const data = supervisor.data;
  if (data.status !== 'ok') {
    items.push(
      healthAttention({
        id: 'health:supervisor-not-ok',
        title: `Supervisor ${data.status}`,
      }),
    );
  }
  if (data.city === undefined) {
    items.push(
      healthWatch({
        id: 'health:supervisor-city-missing',
        title: 'Supervisor city missing',
        summary: 'city was absent from generated supervisor health',
      }),
    );
  }
  if (data.version === undefined) {
    items.push(
      healthWatch({
        id: 'health:supervisor-version-missing',
        title: 'Supervisor version missing',
        summary: 'version was absent from generated supervisor health',
      }),
    );
  }
}

function appendDashboardProcessAttention(items: AttentionItem[], health: SystemHealth): void {
  const admin = health.admin;
  if (admin.uptime_sec < DASHBOARD_PROCESS_STARTING_UPTIME_SEC) {
    items.push(
      healthAttention({
        id: 'health:dashboard-process-starting',
        title: 'Dashboard process just restarted',
        summary: `${admin.uptime_sec}s uptime`,
      }),
    );
  }

  if (admin.rss_bytes >= DASHBOARD_PROCESS_RSS_HIGH_BYTES) {
    items.push(
      healthAttention({
        id: 'health:dashboard-process-rss-high',
        title: 'Dashboard RSS high',
        summary: formatBytes(admin.rss_bytes),
      }),
    );
  } else if (admin.rss_bytes >= DASHBOARD_PROCESS_RSS_ELEVATED_BYTES) {
    items.push(
      healthWatch({
        id: 'health:dashboard-process-rss-elevated',
        title: 'Dashboard RSS elevated',
        summary: formatBytes(admin.rss_bytes),
      }),
    );
  }

  if (admin.heap_used_bytes >= DASHBOARD_PROCESS_HEAP_HIGH_BYTES) {
    items.push(
      healthAttention({
        id: 'health:dashboard-process-heap-high',
        title: 'Dashboard heap high',
        summary: formatBytes(admin.heap_used_bytes),
      }),
    );
  } else if (admin.heap_used_bytes >= DASHBOARD_PROCESS_HEAP_ELEVATED_BYTES) {
    items.push(
      healthWatch({
        id: 'health:dashboard-process-heap-elevated',
        title: 'Dashboard heap elevated',
        summary: formatBytes(admin.heap_used_bytes),
      }),
    );
  }
}

function appendHostAttention(items: AttentionItem[], health: SystemHealth): void {
  const memoryRatio = safeRatio(health.host.free_mem_bytes, health.host.total_mem_bytes);
  if (memoryRatio !== null && memoryRatio < 0.05) {
    items.push(
      healthAttention({
        id: 'health:memory-critical',
        title: 'Host memory critical',
        summary: `${Math.round(memoryRatio * 100)}% free`,
      }),
    );
  } else if (memoryRatio !== null && memoryRatio < 0.1) {
    items.push(
      healthWatch({
        id: 'health:memory-low',
        title: 'Host memory low',
        summary: `${Math.round(memoryRatio * 100)}% free`,
      }),
    );
  }

  const loadRatio = safeRatio(health.host.load_avg_1, health.host.cpu_count);
  if (loadRatio !== null && loadRatio > 1.5) {
    items.push(
      healthAttention({
        id: 'health:load-high',
        title: 'Host load high',
        summary: `${health.host.load_avg_1.toFixed(2)} load across ${health.host.cpu_count} CPUs`,
      }),
    );
  } else if (loadRatio !== null && loadRatio > 1) {
    items.push(
      healthWatch({
        id: 'health:load-elevated',
        title: 'Host load elevated',
        summary: `${health.host.load_avg_1.toFixed(2)} load across ${health.host.cpu_count} CPUs`,
      }),
    );
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${Math.round(bytes / 1_000_000)} MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${bytes} B`;
}

function safeRatio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return numerator / denominator;
}

function healthAttention(
  item: Omit<AttentionItem, 'domain' | 'severity' | 'href' | 'current' | 'actionable'>,
): AttentionItem {
  return {
    domain: 'health',
    severity: 'attention',
    href: '/health',
    current: true,
    actionable: true,
    ...item,
  };
}

function healthWatch(
  item: Omit<AttentionItem, 'domain' | 'severity' | 'href' | 'current' | 'actionable'>,
): AttentionItem {
  return {
    domain: 'health',
    severity: 'watch',
    href: '/health',
    current: true,
    actionable: false,
    ...item,
  };
}

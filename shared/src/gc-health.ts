import type { IsoTimestamp } from './gc-client-types.js';

export interface SystemHealth {
  /** Backend process state — totally local to the admin dashboard's node process. */
  admin: {
    pid: number;
    uptime_sec: number;
    rss_bytes: number;
    heap_used_bytes: number;
    node_version: string;
  };
  /** Machine-level state from Node's os module. */
  host: {
    load_avg_1: number;
    load_avg_5: number;
    load_avg_15: number;
    total_mem_bytes: number;
    free_mem_bytes: number;
    /** Number of logical CPUs. */
    cpu_count: number;
    uptime_sec: number;
  };
}

export type LocalToolVersion =
  | { status: 'available'; version: string; source: string }
  | { status: 'unavailable'; reason: string };

export interface LocalToolVersions {
  dolt: LocalToolVersion;
  beads: LocalToolVersion;
}

export interface DoltNomsSample {
  ts: IsoTimestamp;
  bytes: number;
}

export type DoltNomsUnavailableReason =
  | 'store_health_absent'
  | 'sample_failed';

export type DoltNomsTrend =
  | {
    available: true;
    /** Up to 144 samples (24 h at 10-min cadence). */
    samples: DoltNomsSample[];
    source: string;
  }
  | {
    available: false;
    /** Historical samples, if the source became unavailable after sampling. */
    samples: DoltNomsSample[];
    reason: DoltNomsUnavailableReason;
  };

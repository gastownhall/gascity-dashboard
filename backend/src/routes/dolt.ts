import { Router } from 'express';
import type {
  DoltNomsTrend,
  DoltNomsUnavailableReason,
} from 'gas-city-dashboard-shared';
import type { StatusBody } from '../generated/gc-supervisor-client/types.gen.js';
import { recordAudit } from '../audit.js';
import { LOG_COMPONENT, errorMessage, logWarn } from '../logging.js';

// In-memory ring buffer of dolt-noms size samples — 24 h at 10-minute
// cadence = 144 slots. The metric source is the supervisor's already-exposed
// store_health.size_bytes (GET /v0/city/{name}/status), read via the injected
// status fetch (gascity-dashboard-x82). The ring buffer + /api/dolt-noms/trend
// response shape are independent of the source.

const SLOT_COUNT = 144;
const SAMPLE_INTERVAL_MS = 10 * 60 * 1_000;

// Stable label surfaced on the trend response so the UI can attribute the
// metric to its upstream source.
export const STORE_HEALTH_SOURCE = 'status.store_health.size_bytes';

/** Fetches the supervisor city status (source of store_health.size_bytes). */
export type FetchStatus = () => Promise<StatusBody>;

interface RingSlot {
  ts: string;
  bytes: number;
}

type DoltNomsAvailability =
  | { kind: 'available'; source: string }
  | { kind: 'unavailable'; reason: DoltNomsUnavailableReason };

export interface DoltNomsTimer {
  unref(): void;
}

export interface DoltNomsRuntime {
  setInterval(callback: () => void, delayMs: number): DoltNomsTimer;
  clearInterval(timer: DoltNomsTimer): void;
}

export interface DoltNomsSampler {
  readonly running: boolean;
  start(): void;
  stop(): void;
  sampleOnce(): Promise<void>;
  trend(): DoltNomsTrend;
}

type SamplerTimerState =
  | { status: 'idle' }
  | { status: 'scheduled'; timer: DoltNomsTimer };

const nodeRuntime: DoltNomsRuntime = {
  setInterval: (callback, delayMs) => setInterval(callback, delayMs),
  clearInterval: (timer) => clearInterval(timer as NodeJS.Timeout),
};

export interface DoltNomsSample {
  bytes: number;
  source: string;
}

export type DoltNomsSampleResult =
  | { kind: 'available'; sample: DoltNomsSample }
  | { kind: 'unavailable'; reason: 'store_health_absent' };

export interface DoltNomsSamplerOptions {
  fetchStatus: FetchStatus;
  sample?: (fetchStatus: FetchStatus) => Promise<DoltNomsSampleResult>;
  runtime?: DoltNomsRuntime;
  intervalMs?: number;
  slotCount?: number;
}

export function createDoltNomsSampler(opts: DoltNomsSamplerOptions): DoltNomsSampler {
  const sample = opts.sample ?? sampleDoltNomsSize;
  const runtime = opts.runtime ?? nodeRuntime;
  const intervalMs = opts.intervalMs ?? SAMPLE_INTERVAL_MS;
  const slotCount = opts.slotCount ?? SLOT_COUNT;
  const ring: RingSlot[] = [];
  let availability: DoltNomsAvailability = {
    kind: 'unavailable',
    reason: 'store_health_absent',
  };
  let timerState: SamplerTimerState = { status: 'idle' };

  const sampleOnce = async (): Promise<void> => {
    try {
      const result = await sample(opts.fetchStatus);
      if (result.kind === 'available') {
        ring.push({ ts: new Date().toISOString(), bytes: result.sample.bytes });
        if (ring.length > slotCount) ring.shift();
        availability = { kind: 'available', source: result.sample.source };
      } else {
        availability = { kind: 'unavailable', reason: result.reason };
      }
    } catch (err) {
      availability = { kind: 'unavailable', reason: 'sample_failed' };
      logWarn(LOG_COMPONENT.doltNoms, `sample failed: ${errorMessage(err)}`);
    }
  };

  return {
    get running() {
      return timerState.status === 'scheduled';
    },
    start() {
      if (timerState.status === 'scheduled') return;
      void sampleOnce();
      timerState = {
        status: 'scheduled',
        timer: runtime.setInterval(() => {
          void sampleOnce();
        }, intervalMs),
      };
      timerState.timer.unref();
    },
    stop() {
      if (timerState.status === 'idle') return;
      runtime.clearInterval(timerState.timer);
      timerState = { status: 'idle' };
    },
    sampleOnce,
    trend() {
      const samples = ring.map((s) => ({ ts: s.ts, bytes: s.bytes }));
      return availability.kind === 'available'
        ? {
            available: true,
            samples,
            source: availability.source,
          }
        : {
            available: false,
            samples,
            reason: availability.reason,
          };
    },
  };
}

/**
 * Read the dolt-noms on-disk size from the supervisor's
 * store_health.size_bytes. Returns `unavailable` (store_health_absent) when
 * the supervisor omits store_health (degraded status) so the endpoint can
 * signal available=false rather than reporting a fake zero.
 *
 * Validates at the supervisor trust boundary: a non-finite or negative
 * size_bytes (Infinity / NaN / -1) is meaningless as a byte count and would
 * either serialise as JSON `null` (silent corruption) or render as garbage in
 * the trend, so it is treated as absent. A failed status fetch is NOT caught
 * here — it propagates to the sampler's non-fatal handler, which records the
 * `sample_failed` reason.
 */
export async function sampleDoltNomsSize(
  fetchStatus: FetchStatus,
): Promise<DoltNomsSampleResult> {
  const status = await fetchStatus();
  const sizeBytes = status.store_health?.size_bytes;
  if (typeof sizeBytes !== 'number' || !Number.isFinite(sizeBytes) || sizeBytes < 0) {
    return { kind: 'unavailable', reason: 'store_health_absent' };
  }
  return {
    kind: 'available',
    sample: { bytes: sizeBytes, source: STORE_HEALTH_SOURCE },
  };
}

export function doltRouter(sampler: DoltNomsSampler): Router {
  const router = Router();
  router.get('/trend', (_req, res) => {
    const payload = sampler.trend();
    void recordAudit({
      type: 'dashboard.fetch',
      endpoint: 'GET /api/dolt-noms/trend',
      parsed_args: { samples: String(payload.samples.length) },
      duration_ms: 0,
    });
    res.json(payload);
  });
  return router;
}

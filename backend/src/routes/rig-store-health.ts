import { Router } from 'express';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import type {
  RigStoreCheck,
  RigStoreCheckStatus,
  RigStoreHealth,
  RigStoreHealthReport,
  RigStoreHealthUnavailableReason,
  RigStoreRollup,
} from 'gas-city-dashboard-shared';
import { execBdDoctor } from '../exec.js';
import type { ExecResult } from '../exec.js';
import { recordAudit } from '../audit.js';
import { LOG_COMPONENT, errorMessage, logWarn } from '../logging.js';

// Per-rig bead-store + dolt health (gascity-dashboard-u6d0). Older rigs report
// the rig root and store the beads data in `/.beads`; newer DoltLite-backed
// setups can report the bead-store path directly. Unlike the supervisor's
// single city-level store_health, this is a dashboard-local probe of host
// state:
//   1. bead store present on disk         → reachable
//   2. dolt-server.port + TCP connect      → dolt sql-server up + endpoint
//   3. `bd doctor --json` (read-only)      → schema drift / integrity / count
// rolled up to one red/green-per-rig tone. The probe runs on a periodic
// server-side sampler (heavy: one `bd doctor` per rig) and the route serves
// the cached snapshot, mirroring the dolt-noms sampler — never one fork-storm
// per page load.

const SAMPLE_INTERVAL_MS = 5 * 60 * 1_000;
const TCP_PROBE_TIMEOUT_MS = 2_000;

// `bd doctor` categories that are not bead-store/dolt health and that the
// dashboard operator cannot act on from a store-health view (git-hook hygiene,
// editor plugins). Excluded from both the surfaced problems and the roll-up so
// a healthy store does not read amber for an uninstalled git hook.
const BENIGN_CATEGORIES: ReadonlySet<string> = new Set(['Git Integration', 'Integrations']);

const DOLT_CONNECTION_CHECK = 'Dolt Connection';

/** A rig's name + untrusted supervisor host path, the input to a store probe.
 *  Sourced from the sanctioned backend status read (StatusBody.rig_details),
 *  not a backend rig list — the GcClient is deliberately limited to host-local
 *  reads (see gc-supervisor-generation-config guard). */
export interface SupervisorRigDescriptor {
  name: string;
  path: string;
}

interface RawDoctorCheck {
  category?: unknown;
  name?: unknown;
  status?: unknown;
  message?: unknown;
}

/**
 * Parse `bd doctor --json` stdout into checks. Returns null when the output is
 * not the expected JSON object — which is itself a signal: a store whose dolt
 * server is unreachable makes `bd` fall back to embedded mode and print a
 * human "not supported in embedded mode" note instead of JSON. The caller
 * treats null as an incomplete probe, not a hard error.
 */
export function parseDoctorChecks(stdout: string): RigStoreCheck[] | null {
  const trimmed = stdout.trim();
  if (trimmed.length === 0 || trimmed[0] !== '{') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const checks = (parsed as { checks?: unknown }).checks;
  if (!Array.isArray(checks)) return null;
  return checks
    .filter((c): c is RawDoctorCheck => typeof c === 'object' && c !== null)
    .map((c) => ({
      category: typeof c.category === 'string' ? c.category : 'unknown',
      name: typeof c.name === 'string' ? c.name : 'unknown',
      status: normalizeStatus(c.status),
      message: typeof c.message === 'string' ? c.message : '',
    }));
}

function normalizeStatus(status: unknown): RigStoreCheckStatus {
  const s = typeof status === 'string' ? status.toLowerCase() : '';
  if (s === 'ok' || s === 'pass' || s === 'passed') return 'ok';
  if (s === 'warning' || s === 'warn') return 'warning';
  if (s === 'error' || s === 'fail' || s === 'failed' || s === 'critical') return 'error';
  // Unknown vocabulary: surface it, but at the lower (warning) tier rather
  // than declaring the store down on a status string bd may add later.
  return 'warning';
}

/** Store/dolt checks worth surfacing: non-ok and not a benign hygiene category. */
export function storeProblems(checks: readonly RigStoreCheck[]): RigStoreCheck[] {
  return checks.filter((c) => c.status !== 'ok' && !BENIGN_CATEGORIES.has(c.category));
}

/** Live bead row count from the doctor "Dolt Issue Count" check, when present. */
export function issueCountFromChecks(checks: readonly RigStoreCheck[]): number | null {
  const check = checks.find((c) => c.name.includes('Issue Count'));
  if (check === undefined) return null;
  const match = /(\d[\d,]*)/.exec(check.message);
  const digits = match?.[1];
  if (digits === undefined) return null;
  const n = Number.parseInt(digits.replace(/,/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

/** Fallback dolt-server liveness from doctor when no port file exists to probe. */
function doltConnectedFromChecks(checks: readonly RigStoreCheck[]): boolean | null {
  const check = checks.find((c) => c.name === DOLT_CONNECTION_CHECK);
  if (check === undefined) return null;
  return check.status === 'ok';
}

interface RollupInput {
  reachable: boolean;
  doltConnected: boolean | null;
  problems: readonly RigStoreCheck[];
  incomplete: boolean;
}

/** One red/green-per-rig roll-up tone from the gathered signals. */
export function rollupFor({
  reachable,
  doltConnected,
  problems,
  incomplete,
}: RollupInput): RigStoreRollup {
  if (!reachable) return 'down';
  if (doltConnected === false) return 'down';
  if (problems.some((p) => p.status === 'error')) return 'down';
  if (problems.some((p) => p.status === 'warning')) return 'warn';
  if (incomplete) return 'warn';
  return 'ok';
}

// ── Probe dependencies (injectable for tests) ────────────────────────────

export interface RigStoreProbeDeps {
  /** True when `<beadsPath>` is an existing directory. */
  statBeads(beadsPath: string): Promise<boolean>;
  /** Configured dolt server port from `<beadsPath>/dolt-server.port`, or null. */
  readPort(beadsPath: string): Promise<number | null>;
  /** True when a TCP connection to 127.0.0.1:port succeeds within the timeout. */
  tcpProbe(port: number): Promise<boolean>;
  /** `bd doctor --readonly --db <beadsPath> --json`. */
  runDoctor(beadsPath: string): Promise<ExecResult>;
}

export const defaultRigStoreProbeDeps: RigStoreProbeDeps = {
  async statBeads(beadsPath) {
    try {
      const st = await fs.promises.stat(beadsPath);
      return st.isDirectory();
    } catch {
      return false;
    }
  },
  async readPort(beadsPath) {
    try {
      const raw = await fs.promises.readFile(path.join(beadsPath, 'dolt-server.port'), 'utf-8');
      const port = Number.parseInt(raw.trim(), 10);
      return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : null;
    } catch {
      return null;
    }
  },
  tcpProbe(port) {
    return new Promise<boolean>((resolve) => {
      const socket = net.connect({ host: '127.0.0.1', port });
      const done = (ok: boolean) => {
        socket.destroy();
        resolve(ok);
      };
      socket.setTimeout(TCP_PROBE_TIMEOUT_MS);
      socket.once('connect', () => done(true));
      socket.once('timeout', () => done(false));
      socket.once('error', () => done(false));
    });
  },
  runDoctor: execBdDoctor,
};

/**
 * Probe one rig's `.beads` store into a RigStoreHealth. Doctor failures and a
 * non-JSON (embedded-mode) fallback are caught here and folded into the result
 * rather than thrown; the default deps' fs/net probes resolve instead of
 * rejecting. The sampler still wraps this in `safeProbe` so an unexpected
 * throw from an injected dep cannot abort the whole sample.
 */
export async function probeRigStore(
  rig: SupervisorRigDescriptor,
  deps: RigStoreProbeDeps,
): Promise<RigStoreHealth> {
  const beadsPath = resolveBeadsPath(rig.path);
  const reachable = await deps.statBeads(beadsPath);
  if (!reachable) {
    return {
      rig: rig.name,
      beadsPath,
      rollup: 'down',
      reachable: false,
      doltEndpoint: null,
      doltConnected: null,
      issueCount: null,
      problems: [],
      note: '.beads store not found on disk',
    };
  }

  const port = await deps.readPort(beadsPath);
  const doltEndpoint = port !== null ? `127.0.0.1:${port}` : null;

  let checks: RigStoreCheck[] | null = null;
  let note: string | undefined;
  try {
    const result = await deps.runDoctor(beadsPath);
    checks = parseDoctorChecks(result.stdout);
    if (checks === null) {
      note = 'bd doctor returned no JSON (embedded mode or dolt server unreachable)';
    }
  } catch (err) {
    note = `bd doctor probe failed: ${errorMessage(err)}`;
  }

  let doltConnected: boolean | null;
  if (port !== null) {
    doltConnected = await deps.tcpProbe(port);
  } else {
    doltConnected = checks !== null ? doltConnectedFromChecks(checks) : null;
  }

  const problems = checks !== null ? storeProblems(checks) : [];
  const issueCount = checks !== null ? issueCountFromChecks(checks) : null;
  const rollup = rollupFor({
    reachable,
    doltConnected,
    problems,
    incomplete: note !== undefined,
  });

  return {
    rig: rig.name,
    beadsPath,
    rollup,
    reachable,
    doltEndpoint,
    doltConnected,
    issueCount,
    problems,
    ...(note !== undefined ? { note } : {}),
  };
}

// One-shot guard: log the first time a rig reports its bead-store path directly
// so the DoltLite direct-store premise is confirmable in production, without
// spamming the warn stream on every sample cycle (gascity-dashboard-ahwg).
let directStoreLogged = false;

/**
 * Resolve a rig's untrusted supervisor path to its bead-store directory. Older
 * rigs report the rig root (store lives at `<root>/.beads`); DoltLite rigs can
 * report the store path directly. Trailing separators are stripped first so a
 * `/foo/.beads/` path is recognised as the store and returns a clean path,
 * rather than being re-nested to `/foo/.beads/.beads`. This is the single
 * definition shared by the happy path and safeProbe's error fallback.
 */
export function resolveBeadsPath(rigPath: string): string {
  const normalized = rigPath.replace(/\/+$/, '');
  if (path.basename(normalized) === '.beads') {
    if (!directStoreLogged) {
      directStoreLogged = true;
      logWarn(
        LOG_COMPONENT.rigStoreHealth,
        `rig reported a bead-store path directly (direct-store rig class); using as-is: ${normalized}`,
      );
    }
    return normalized;
  }
  return path.join(normalized, '.beads');
}

// ── Sampler ──────────────────────────────────────────────────────────────

export interface SamplerTimer {
  unref(): void;
}

export interface SamplerRuntime {
  setInterval(callback: () => void, delayMs: number): SamplerTimer;
  clearInterval(timer: SamplerTimer): void;
}

const nodeRuntime: SamplerRuntime = {
  setInterval: (callback, delayMs) => setInterval(callback, delayMs),
  clearInterval: (timer) => clearInterval(timer as NodeJS.Timeout),
};

export interface RigStoreHealthSampler {
  readonly running: boolean;
  start(): void;
  stop(): void;
  sampleOnce(): Promise<void>;
  report(): RigStoreHealthReport;
}

export interface RigStoreHealthSamplerOptions {
  listRigs: () => Promise<readonly SupervisorRigDescriptor[]>;
  probe?: (rig: SupervisorRigDescriptor) => Promise<RigStoreHealth>;
  deps?: RigStoreProbeDeps;
  runtime?: SamplerRuntime;
  intervalMs?: number;
  now?: () => string;
}

type SamplerTimerState = { status: 'idle' } | { status: 'scheduled'; timer: SamplerTimer };

export function createRigStoreHealthSampler(
  opts: RigStoreHealthSamplerOptions,
): RigStoreHealthSampler {
  const deps = opts.deps ?? defaultRigStoreProbeDeps;
  const probe = opts.probe ?? ((rig: SupervisorRigDescriptor) => probeRigStore(rig, deps));
  const runtime = opts.runtime ?? nodeRuntime;
  const intervalMs = opts.intervalMs ?? SAMPLE_INTERVAL_MS;
  const now = opts.now ?? (() => new Date().toISOString());

  // Last successful per-rig snapshot. Retained across a later failed rig-list
  // read so the report can still carry prior data (degraded, not blank).
  let rigs: RigStoreHealth[] = [];
  let sampledAt: string | null = null;
  let lastReason: RigStoreHealthUnavailableReason = 'not_sampled_yet';
  let available = false;
  let timerState: SamplerTimerState = { status: 'idle' };

  const sampleOnce = async (): Promise<void> => {
    let descriptors: readonly SupervisorRigDescriptor[];
    try {
      descriptors = await opts.listRigs();
    } catch (err) {
      available = false;
      lastReason = 'rig_list_failed';
      logWarn(LOG_COMPONENT.rigStoreHealth, `rig list failed: ${errorMessage(err)}`);
      return;
    }
    rigs = await Promise.all(descriptors.map((rig) => safeProbe(probe, rig)));
    sampledAt = now();
    available = true;
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
    report(): RigStoreHealthReport {
      if (available && sampledAt !== null) {
        return { available: true, sampledAt, rigs };
      }
      return { available: false, reason: lastReason, rigs };
    },
  };
}

async function safeProbe(
  probe: (rig: SupervisorRigDescriptor) => Promise<RigStoreHealth>,
  rig: SupervisorRigDescriptor,
): Promise<RigStoreHealth> {
  try {
    return await probe(rig);
  } catch (err) {
    return {
      rig: rig.name,
      beadsPath: resolveBeadsPath(rig.path),
      rollup: 'down',
      reachable: false,
      doltEndpoint: null,
      doltConnected: null,
      issueCount: null,
      problems: [],
      note: `probe failed: ${errorMessage(err)}`,
    };
  }
}

export function rigStoreHealthRouter(sampler: RigStoreHealthSampler): Router {
  const router = Router();
  router.get('/', (_req, res) => {
    const payload = sampler.report();
    void recordAudit({
      type: 'dashboard.fetch',
      endpoint: 'GET /api/city/:cityName/rig-store-health',
      parsed_args: { rigs: String(payload.rigs.length) },
      duration_ms: 0,
    });
    res.json(payload);
  });
  return router;
}

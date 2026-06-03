import { runExec } from '../exec-core.js';
import { errorMessage } from '../logging.js';

// The gc supervisor API exposes no Dolt or Beads binary version, so the
// dashboard probes them locally on the 127.0.0.1 backend host via
// `dolt version` / `bd version`. A failed probe is surfaced with a reason,
// never swallowed into a fake version string.

const VERSION_PROBE_TIMEOUT_MS = 3_000;
const SEMVER_RE = /(\d+\.\d+\.\d+)/;

export type VersionProbeResult =
  | { kind: 'ok'; version: string }
  | { kind: 'error'; reason: string };

export type VersionProbe = () => Promise<VersionProbeResult>;

export function parseVersion(stdout: string): string | null {
  return SEMVER_RE.exec(stdout)?.[1] ?? null;
}

async function probeVersion(cmd: string): Promise<VersionProbeResult> {
  try {
    const result = await runExec(cmd, ['version'], VERSION_PROBE_TIMEOUT_MS);
    if (result.exitCode !== 0) {
      const detail = result.stderr.trim() || result.stdout.trim() || 'no output';
      return { kind: 'error', reason: `${cmd} version exited ${result.exitCode}: ${detail}` };
    }
    const version = parseVersion(result.stdout);
    if (version === null) {
      return { kind: 'error', reason: `${cmd} version output had no recognizable version` };
    }
    return { kind: 'ok', version };
  } catch (err) {
    return { kind: 'error', reason: `${cmd} version probe failed: ${errorMessage(err)}` };
  }
}

export const probeDoltVersion: VersionProbe = () => probeVersion('dolt');

export const probeBeadsVersion: VersionProbe = () => probeVersion('bd');

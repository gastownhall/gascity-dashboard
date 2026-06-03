import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Ids / aliases / city paths are conservative tokens; validate before any value
// reaches a shell-interpreted tmux command (defence in depth — no injection).
const SAFE_ID = /^[A-Za-z0-9._-]+$/;
const SAFE_PATH = /^[A-Za-z0-9._/-]+$/;

// Helper scripts live next to this workspace's src/ (tui/*.sh).
const RUN_SCRIPT = fileURLToPath(new URL('../peek-run.sh', import.meta.url));
const AGENT_SCRIPT = fileURLToPath(new URL('../peek-agent.sh', import.meta.url));

export function insideTmux(): boolean {
  return Boolean(process.env.TMUX);
}

export type PeekKind = 'agent' | 'bead' | 'run' | 'mail';

export interface PeekRequest {
  readonly kind: PeekKind;
  readonly id: string;
  readonly cityRoot: string | null;
  readonly city: string;
  readonly baseUrl: string;
}

export interface PeekResult {
  readonly ok: boolean;
  /** tmux pane id of the peek pane (e.g. "%7"), set on a successful open. */
  readonly paneId?: string;
  readonly error?: string;
}

/**
 * Builds the shell command for a peek, by kind. All commands READ
 * (logs/show/diff) — none attaches as a tmux client, so peeking can't resize or
 * disturb a running agent. `--city`/explicit paths are passed because the pane
 * inherits the TUI's cwd, which is usually not a city directory. `; exec $SHELL`
 * keeps the pane open so output/errors stay readable.
 */
export function buildCommand(req: PeekRequest): string | { error: string } {
  if (!insideTmux()) {
    return { error: 'not inside tmux — launch with `npm --workspace tui run start:tmux`' };
  }
  if (!req.cityRoot) return { error: 'city path not loaded yet — retry in a moment' };
  if (!SAFE_PATH.test(req.cityRoot)) return { error: `unsafe city path: ${req.cityRoot}` };
  if (!SAFE_ID.test(req.id)) return { error: `unsafe id: ${req.id}` };
  const root = req.cityRoot;
  switch (req.kind) {
    case 'agent':
      // peek-agent.sh follows the transcript if one exists, else watches pane
      // snapshots (works for non-transcript sessions like dispatchers).
      return `bash '${AGENT_SCRIPT}' '${root}' '${req.id}'`;
    case 'bead':
      return `gc --city ${root} bd show ${req.id}; exec $SHELL`;
    case 'mail':
      // `mail peek` shows the message WITHOUT marking it read (read-only posture).
      return `gc --city ${root} mail peek ${req.id}; exec $SHELL`;
    case 'run':
      // peek-run.sh prints `bd show <run>` then the code diff; args are
      // single-quoted (all validated/owned, no quotes) for the sh -c tmux runs.
      return `bash '${RUN_SCRIPT}' '${root}' '${req.city}' '${req.baseUrl}' '${req.id}'`;
  }
}

function tmuxFail(r: ReturnType<typeof spawnSync>): string {
  if (r.error) return r.error.message;
  const detail = (r.stderr?.toString() ?? '').trim();
  return `tmux: ${detail || `exit ${r.status}`}`;
}

/** True if a pane with this id currently exists anywhere in the server. */
export function paneExists(paneId: string): boolean {
  const r = spawnSync('tmux', ['list-panes', '-a', '-F', '#{pane_id}'], { encoding: 'utf8' });
  if (r.status !== 0 || typeof r.stdout !== 'string') return false;
  return r.stdout.split('\n').includes(paneId);
}

/**
 * Opens the peek pane BELOW the dashboard (focus stays on the dashboard). A
 * vertical split (not a right-hand one) keeps the dashboard's full width — it is
 * often already narrow when pinned beside the mayor — and gives wide peek output
 * (logs, `bd show`, diffs) the full width too.
 */
export function openPeek(command: string): PeekResult {
  // -d: don't move focus. -v: split below. -P -F prints the new pane's id so we
  // can retarget it.
  const r = spawnSync(
    'tmux',
    ['split-window', '-d', '-v', '-l', '50%', '-P', '-F', '#{pane_id}', command],
    { encoding: 'utf8' },
  );
  if (r.error || (typeof r.status === 'number' && r.status !== 0)) {
    return { ok: false, error: tmuxFail(r) };
  }
  return { ok: true, paneId: (r.stdout ?? '').trim() };
}

/** Retargets the existing peek pane (reuses one pane instead of stacking). */
export function replacePeek(paneId: string, command: string): PeekResult {
  const r = spawnSync('tmux', ['respawn-pane', '-k', '-t', paneId, command], { encoding: 'utf8' });
  if (r.error || (typeof r.status === 'number' && r.status !== 0)) {
    return { ok: false, error: tmuxFail(r) };
  }
  return { ok: true, paneId };
}

/** Closes the peek pane. */
export function closePeek(paneId: string): void {
  spawnSync('tmux', ['kill-pane', '-t', paneId], { stdio: 'ignore' });
}

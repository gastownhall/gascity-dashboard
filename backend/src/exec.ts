import { isValidHostPath } from './lib/hostPath.js';
import {
  AGENT_ALIAS_RE,
  ExecError,
  MAX_BYTES,
  MAX_BYTES_LARGE,
  MAX_RUN_DIFF_BYTES,
  runExec,
  type ExecResult,
} from './exec-core.js';
import { RUN_REVIEWABLE_PATHS } from './runs/run-diff-policy.js';

export { AGENT_ALIAS_RE, ExecError };
export type { ExecResult };

// Whitelisted-only shell-exec wrapper. Every privileged invocation in the
// app routes through this — there is intentionally no general-purpose
// exec helper exported elsewhere.
//
// Per security_researcher td-wisp-eb0pn:
//   - ENUM whitelist of allowed commands.
//   - shell:false (non-negotiable).
//   - Clean env — no inherited environment; PATH/HOME/LANG are assigned
//     intentionally by exec-core.
//   - Timeout (10-30s) + output cap (100KB).
//   - Concurrency cap (semaphore).
//   - Bead-id / agent-alias param schemas enforced.

// Strip ANSI / OSC / control chars from peek output. Per
// security_researcher's regex spec. Server-side strip happens BEFORE the
// content reaches the browser; ansi_up on the client only ever sees
// safe SGR sequences (or none).
const CSI_NON_SGR_RE = /\x1b\[[?0-9;]*[a-ln-zA-LN-Z]/g; // CSI but excluding 'm' (SGR)
// OSC sequences end in one of two terminators:
//   - BEL (\x07) — the xterm-legacy form.
//   - ST as ESC \\ (\x1b\\) — the spec form most modern terminals emit
//     (iTerm2, foot, wezterm). The single-byte C1 ST (\x9c) is handled
//     by CTRL_RE which strips the whole \x80-\x9f range.
// gascity-dashboard-3sxy.1: prior to this we only matched the BEL form,
// so ST-terminated OSC payloads survived the strip — CTRL_RE removed
// the leading and trailing ESC bytes but the bracketed payload was
// left as visible plain text. The char-class excludes \x1b so an
// unterminated OSC cannot consume a following ANSI escape.
const OSC_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
// C0 (everything < 0x20 except \t \n) + DEL + C1 (\x80-\x9f).
// gascity-dashboard-3sxy: C1 controls are legacy 8-bit control codes
// some terminals still interpret as alternative escape introducers;
// they are the same threat class as C0 and must be stripped together.
const CTRL_RE = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g;
// gascity-dashboard-cnu + Phase-4 M1: ALL 12 Unicode Bidi / RTL
// codepoints from CVE-2021-42574 (Boucher/Anderson 2021):
// U+061C (ALM), U+200E (LRM), U+200F (RLM), U+202A-202E (LRE/RLE/PDF/
// LRO/RLO), U+2066-2069 (LRI/RLI/FSI/PDI). The 3 marks (ALM/LRM/RLM)
// are zero-width directional hints rather than embedding/overrides,
// but they're in the same Unicode bidi-control category — the CVE
// listed all 12 and a comprehensive strip costs nothing.
const BIDI_RE = /[؜‎‏‪-‮⁦-⁩]/g;
const GIT_LOG_RECENT_LIMIT = '200';
const GIT_LOG_TIMEOUT_MS = 10_000;
const RUN_GIT_TIMEOUT_MS = 5_000;
const GH_LIST_TIMEOUT_MS = 30_000;
const GH_HISTORY_LIST_TIMEOUT_MS = 60_000;
function sanitiseTerminalOutput(raw: string): string {
  return raw
    .replace(OSC_RE, '')
    .replace(CSI_NON_SGR_RE, '')
    .replace(CTRL_RE, '')
    .replace(BIDI_RE, '');
}

// ── Public exec wrappers — each one is a named, whitelisted call. ──────
//
// GC-related reads and writes use the generated supervisor client directly.
// This file contains only dashboard-local git/gh operations.

// Hardcoded enum of `git log` invocations. Each view's args live entirely
// in this file — the operator cannot pass arbitrary git arguments to the
// server. The caller can only pick a view *name* (validated upstream).
// Recent views use an explicit count cap sized for roughly two weeks of
// active main-branch commits. The since= variants are time-windowed, not
// count-windowed, so git's default result count is the correct limit there.
const GIT_LOG_VIEWS: Record<string, string[]> = {
  'recent-main': [
    'log',
    '--pretty=format:%H%x09%h%x09%an%x09%aI%x09%D%x09%s',
    '-n',
    GIT_LOG_RECENT_LIMIT,
    'origin/main',
  ],
  'recent-all': [
    'log',
    '--pretty=format:%H%x09%h%x09%an%x09%aI%x09%D%x09%s',
    '-n',
    GIT_LOG_RECENT_LIMIT,
    '--branches',
    '--remotes',
  ],
  today: [
    'log',
    '--pretty=format:%H%x09%h%x09%an%x09%aI%x09%D%x09%s',
    '--since=24.hours.ago',
    '--branches',
    '--remotes',
  ],
  'this-week': [
    'log',
    '--pretty=format:%H%x09%h%x09%an%x09%aI%x09%D%x09%s',
    '--since=7.days.ago',
    '--branches',
    '--remotes',
  ],
};

const GIT_REPO_PATH = process.env.ADMIN_GIT_REPO ?? process.env.HOME ?? '';

export async function execGitLog(view: string): Promise<ExecResult> {
  const args = GIT_LOG_VIEWS[view];
  if (!args) {
    throw new ExecError('unknown git view', 'validation');
  }
  return runExec('git', ['-C', GIT_REPO_PATH, ...args], GIT_LOG_TIMEOUT_MS);
}

type RunGitView =
  | 'root'
  | 'status'
  | 'untracked'
  | 'upstream'
  | 'merge-base-upstream'
  | 'diff-head'
  | 'name-status-head';

const RUN_GIT_VIEWS: Record<RunGitView, string[]> = {
  root: ['rev-parse', '--show-toplevel'],
  status: ['status', '--porcelain=v1', '--untracked-files=all', ...RUN_REVIEWABLE_PATHS],
  untracked: ['ls-files', '--others', '--exclude-standard', '-z'],
  upstream: ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
  'merge-base-upstream': ['merge-base', 'HEAD', '@{upstream}'],
  'diff-head': ['diff', '--no-ext-diff', '--no-color', 'HEAD', ...RUN_REVIEWABLE_PATHS],
  'name-status-head': [
    'diff',
    '--name-status',
    '--no-ext-diff',
    '--no-color',
    'HEAD',
    ...RUN_REVIEWABLE_PATHS,
  ],
};

/**
 * Whitelisted git reads for formula run detail diffs. The execution path
 * comes from supervisor-owned run metadata, not a browser parameter, but it is
 * still validated here so every subprocess boundary remains in this file.
 */
// gascity-dashboard-k2b8: `allowedRoots` is REQUIRED on the run-git boundary
// functions (not defaulted) so a caller cannot silently skip the cwd
// prefix gate by omitting it. Pass `[]` only to deliberately opt into
// shape-only validation — the single opt-in seam lives in readRunGitDiff /
// RunsRouterOptions, sourced from config.runCwdAllowedRoots.
export async function execRunGit(
  cwd: string,
  view: RunGitView,
  allowedRoots: readonly string[],
): Promise<ExecResult> {
  if (!isValidRunCwd(cwd, allowedRoots)) {
    throw new ExecError('invalid run cwd', 'validation');
  }
  const args = RUN_GIT_VIEWS[view];
  return runExec(
    'git',
    ['-C', cwd, ...args],
    RUN_GIT_TIMEOUT_MS,
    view === 'diff-head' ? MAX_RUN_DIFF_BYTES : MAX_BYTES,
  );
}

export async function execRunGitDiffFrom(
  cwd: string,
  baseRevision: string,
  allowedRoots: readonly string[],
): Promise<ExecResult> {
  if (!isValidRunCwd(cwd, allowedRoots) || !/^[0-9a-f]{40,64}$/i.test(baseRevision)) {
    throw new ExecError('invalid run git diff args', 'validation');
  }
  return runExec(
    'git',
    ['-C', cwd, 'diff', '--no-ext-diff', '--no-color', baseRevision, ...RUN_REVIEWABLE_PATHS],
    RUN_GIT_TIMEOUT_MS,
    MAX_RUN_DIFF_BYTES,
  );
}

export async function execRunGitNameStatusFrom(
  cwd: string,
  baseRevision: string,
  allowedRoots: readonly string[],
): Promise<ExecResult> {
  if (!isValidRunCwd(cwd, allowedRoots) || !/^[0-9a-f]{40,64}$/i.test(baseRevision)) {
    throw new ExecError('invalid run git name-status args', 'validation');
  }
  return runExec(
    'git',
    [
      '-C',
      cwd,
      'diff',
      '--name-status',
      '--no-ext-diff',
      '--no-color',
      baseRevision,
      ...RUN_REVIEWABLE_PATHS,
    ],
    RUN_GIT_TIMEOUT_MS,
  );
}

export async function execRunGitNewFileDiff(
  cwd: string,
  filePath: string,
  allowedRoots: readonly string[],
  maxBytes = MAX_RUN_DIFF_BYTES,
): Promise<ExecResult> {
  if (!isValidRunCwd(cwd, allowedRoots) || !isValidRunRelativePath(filePath)) {
    throw new ExecError('invalid run git diff path', 'validation');
  }
  return runExec(
    'git',
    ['-C', cwd, 'diff', '--no-index', '--no-ext-diff', '--no-color', '--', '/dev/null', filePath],
    RUN_GIT_TIMEOUT_MS,
    maxBytes,
  );
}

/**
 * Validate a run cwd before it is handed to `git -C <cwd>`. The cwd comes
 * from supervisor run metadata (gc.cwd / gc.work_dir / gc.rig_root), so this
 * is the dashboard's last shell-read gate (gascity-dashboard-k2b8).
 *
 * Two layers:
 *  1. Shape — reuse the shared isValidHostPath gate (absolute, no NUL, no `..`
 *     traversal segment), the same rule applied to supervisor host paths
 *     elsewhere.
 *  2. Prefix allowlist — when `allowedRoots` is non-empty the cwd must sit at
 *     or under one sanctioned root, so a buggy/compromised supervisor value
 *     cannot point git at an arbitrary host repo. An empty list (the default)
 *     keeps the shape-only behavior, preserving deployments that don't
 *     configure RUN_CWD_ALLOWED_ROOTS.
 */
export function isValidRunCwd(
  cwd: string,
  allowedRoots: readonly string[] = [],
): boolean {
  if (!isValidHostPath(cwd)) return false;
  if (allowedRoots.length === 0) return true;
  return allowedRoots.some((root) => isPathUnderRoot(cwd, root));
}

/**
 * True when `cwd` equals `root` or is nested under it, matching on path
 * SEGMENT boundaries — `/home/ds/gascity` admits `/home/ds/gascity/x` but not
 * the sibling `/home/ds/gascity-evil`, which a naive startsWith would wrongly
 * accept.
 */
function isPathUnderRoot(cwd: string, root: string): boolean {
  const normalizedRoot = root.endsWith('/') ? root.slice(0, -1) : root;
  return cwd === normalizedRoot || cwd.startsWith(`${normalizedRoot}/`);
}

function isValidRunRelativePath(filePath: string): boolean {
  return (
    filePath.length > 0 &&
    !filePath.startsWith('/') &&
    !filePath.includes('\0') &&
    !filePath.split('/').includes('..')
  );
}

// ── Maintainer triage: gh CLI wrappers ───────────────────────────────
//
// gascity-dashboard-361. Pulls open issues + PRs from a GitHub repo
// through the `gh` CLI. The repo is server-config-bound (not a request
// parameter) and validated against a tight pattern; gh's --json
// argument is hardcoded server-side so the operator can't expand the
// field set from the browser. 30s timeout because gh hits api.github.com
// across the public internet; cap stays at 100KB but a busy repo with
// 100+ open items can crowd that — see notes on --limit.

const GH_REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

// `body` is deliberately omitted from the ingest json: a single repo with
// 500 long-body items easily blows past runExec's 100KB MAX_BYTES cap,
// and bead 361 doesn't render bodies anyway. Enrichment beads (gtr's
// blast-radius LLM extraction, 98h's embeddings) fetch bodies on demand
// for the subset of items they need to classify, via separate gh calls.
const GH_ISSUE_FIELDS = 'number,title,createdAt,updatedAt,author,labels,url';
// `closingIssuesReferences` is not present in gh 2.45. PR -> issue
// linkage gets derived by parsing PR bodies for "Fixes #N" / "Closes
// #N" / "Resolves #N" in triage.ts; `body` is fetched here for that
// purpose only. Issue bodies stay omitted: not used by ingest, and the
// 262-issue payload only fits the 2MB MAX_BYTES_LARGE cap because we
// don't carry them.
const GH_PR_FIELDS =
  'number,title,createdAt,updatedAt,author,labels,url,body,additions,deletions,reviewDecision,isDraft,state,files';

/**
 * `gh issue list --repo <repo> --state open --json <fields> --limit <n>`
 * Returns the raw JSON array as stdout. Caller parses + maps.
 */
export async function execGhIssueList(
  repo: string,
  limit: number,
): Promise<ExecResult> {
  if (!GH_REPO_RE.test(repo)) {
    throw new ExecError('invalid repo (expected owner/name)', 'validation');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new ExecError('invalid limit (1..1000)', 'validation');
  }
  return runExec(
    'gh',
    [
      'issue',
      'list',
      '--repo',
      repo,
      '--state',
      'open',
      '--json',
      GH_ISSUE_FIELDS,
      '--limit',
      String(limit),
    ],
    GH_LIST_TIMEOUT_MS,
    MAX_BYTES_LARGE,
  );
}

/**
 * `gh issue list --repo <repo> --state all --json number,author,state,stateReason
 *  --limit <n>` — pulls the full lifetime issue history (open + closed,
 *  any reason) so the contributor-stats module can tally per-author
 *  totals without per-login round-trips. Returned shape is intentionally
 *  thin: no titles, no bodies, no labels — only what's needed to count.
 */
export async function execGhIssueListAll(
  repo: string,
  limit: number,
): Promise<ExecResult> {
  if (!GH_REPO_RE.test(repo)) {
    throw new ExecError('invalid repo (expected owner/name)', 'validation');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 10000) {
    throw new ExecError('invalid limit (1..10000)', 'validation');
  }
  return runExec(
    'gh',
    [
      'issue',
      'list',
      '--repo',
      repo,
      '--state',
      'all',
      '--json',
      'number,author,state',
      '--limit',
      String(limit),
    ],
    GH_HISTORY_LIST_TIMEOUT_MS,
    MAX_BYTES_LARGE,
  );
}

/**
 * `gh pr list --repo <repo> --state all --json number,author,state --limit <n>`
 *  — same idea as execGhIssueListAll but for PRs. state values include
 *  OPEN / CLOSED / MERGED.
 */
export async function execGhPrListAll(
  repo: string,
  limit: number,
): Promise<ExecResult> {
  if (!GH_REPO_RE.test(repo)) {
    throw new ExecError('invalid repo (expected owner/name)', 'validation');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 10000) {
    throw new ExecError('invalid limit (1..10000)', 'validation');
  }
  return runExec(
    'gh',
    [
      'pr',
      'list',
      '--repo',
      repo,
      '--state',
      'all',
      '--json',
      'number,author,state',
      '--limit',
      String(limit),
    ],
    GH_HISTORY_LIST_TIMEOUT_MS,
    MAX_BYTES_LARGE,
  );
}

/**
 * `gh pr list --repo <repo> --state open --json <fields> --limit <n>`
 */
export async function execGhPrList(
  repo: string,
  limit: number,
): Promise<ExecResult> {
  if (!GH_REPO_RE.test(repo)) {
    throw new ExecError('invalid repo (expected owner/name)', 'validation');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new ExecError('invalid limit (1..1000)', 'validation');
  }
  return runExec(
    'gh',
    [
      'pr',
      'list',
      '--repo',
      repo,
      '--state',
      'open',
      '--json',
      GH_PR_FIELDS,
      '--limit',
      String(limit),
    ],
    GH_LIST_TIMEOUT_MS,
    MAX_BYTES_LARGE,
  );
}

export { sanitiseTerminalOutput };

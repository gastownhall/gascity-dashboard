import type { Response } from 'express';
import { Router } from 'express';
import type {
  RunDiffRequest,
  RunExecutionPath,
  RunScopeKind,
} from 'gas-city-dashboard-shared';
import { BEAD_ID_RE } from '../lib/beadId.js';
import { fromRequestScope } from '../lib/run-scope.js';
import { LOG_COMPONENT } from '../logging.js';
import {
  routeInternalError,
  routeValidationError,
  writeRouteError,
} from '../route-errors.js';
import { readRunGitDiff } from '../runs/diff.js';

export interface RunsRouterOptions {
  /**
   * Opt-in path-prefix allowlist for run-detail git reads
   * (gascity-dashboard-k2b8). Threaded into readRunGitDiff so the cwd fed to
   * `git -C` must live under a sanctioned root. Empty / omitted preserves the
   * prior shape-only validation. Sourced from config.runCwdAllowedRoots.
   */
  runCwdAllowedRoots?: readonly string[];
}

export function runsRouter(
  opts: RunsRouterOptions = {},
): Router {
  const router = Router();

  router.post('/:runId/diff', async (req, res) => {
    const parsed = parseRunRequest(req.params.runId, req.query);
    if (!parsed.ok) {
      writeRouteError(res, routeValidationError(parsed.error));
      return;
    }
    const body = parseRunDiffBody(req.body);
    if (!body.ok) {
      writeRouteError(res, routeValidationError(body.error));
      return;
    }
    try {
      const diff = await readRunGitDiff(body.executionPath, opts.runCwdAllowedRoots ?? []);
      res.json(diff);
    } catch (err) {
      writeRunError(res, err, 'failed to fetch run diff');
    }
  });

  return router;
}

type ParseResult =
  | {
    ok: true;
    runId: string;
    scope?: { scopeKind: RunScopeKind; scopeRef: string };
  }
  | { ok: false; error: string };

function parseRunRequest(
  runId: string,
  query: Record<string, unknown>,
): ParseResult {
  if (!BEAD_ID_RE.test(runId)) {
    return { ok: false, error: 'invalid run id' };
  }
  if (query.scope_kind !== undefined && typeof query.scope_kind !== 'string') {
    return { ok: false, error: 'invalid scope kind' };
  }
  if (query.scope_ref !== undefined && typeof query.scope_ref !== 'string') {
    return { ok: false, error: 'invalid scope ref' };
  }
  const scope = fromRequestScope(query);
  if (!scope.ok) return scope;
  return scope.scope !== undefined
    ? { ok: true, runId, scope: scope.scope }
    : { ok: true, runId };
}

type RunDiffBodyResult =
  | { ok: true; executionPath: RunExecutionPath }
  | { ok: false; error: string };

function parseRunDiffBody(body: unknown): RunDiffBodyResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'request body must be a JSON object' };
  }
  const raw = (body as Partial<RunDiffRequest>).executionPath;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'executionPath must be an object' };
  }
  if (raw.kind === 'known') {
    return typeof raw.path === 'string' && raw.path.trim().length > 0
      ? { ok: true, executionPath: { kind: 'known', path: raw.path } }
      : { ok: false, error: 'executionPath.path must be a non-empty string' };
  }
  if (raw.kind === 'unavailable') {
    return raw.reason === 'missing_cwd_and_rig_root'
      ? { ok: true, executionPath: { kind: 'unavailable', reason: raw.reason } }
      : { ok: false, error: 'executionPath.reason is invalid' };
  }
  return { ok: false, error: 'executionPath.kind is invalid' };
}

function writeRunError(
  res: Response,
  err: unknown,
  fallbackMessage: string,
): void {
  writeRouteError(res, routeInternalError(err, {
    component: LOG_COMPONENT.runs,
    operation: fallbackMessage,
    responseError: fallbackMessage,
  }));
}

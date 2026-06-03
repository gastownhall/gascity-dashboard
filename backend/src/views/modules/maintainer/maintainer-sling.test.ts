import express from 'express';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, test } from 'node:test';
// ExecError is still used by the /refresh tests below — that route shells
// `gh` (execGhIssueList) and maps ExecError kinds to wire codes. The /sling
// path no longer throws ExecError (it POSTs to the supervisor via GcClient).
import { ExecError } from '../../../exec.js';
import { maintainerRouter } from './router.js';
import { setAuditLogPath } from '../../../audit.js';
import { readSlungState, slungKey, writeSlungEntry } from './slung-state.js';
import type {
  GcSession,
  MaintainerTriage,
  SlingInput,
  SlingResponse,
  TriageItem,
} from 'gas-city-dashboard-shared';
import { makePr } from './fixtures/triage-item.js';
import { assertWireDetails } from '../../../../test/helpers/wire.js';

// Tests for POST /api/maintainer/sling (gascity-dashboard-ib5,
// gascity-dashboard-mq2). The route POSTs to the supervisor's /sling
// endpoint via GcClient; the router accepts the `sling` fn via DI so tests
// can stub the HTTP call without standing up a fake supervisor. Audit
// assertions hit a tmp file via setAuditLogPath.

type SlingStub = (input: SlingInput) => Promise<SlingResponse>;

interface AppHandle {
  url: string;
  close: () => Promise<void>;
  auditPath: string;
  calls: SlingInput[];
}

interface BuildOpts {
  sling?: SlingStub;
  slingTarget?: string;
  triageTarget?: string;
  /**
   * gascity-dashboard-55b: injected supervisor sessions fetcher used by
   * the sling handler to resolve the target role into a concrete
   * session_name. When omitted, the route cannot resolve the target and
   * persists resolved_session_name=null.
   */
  listSessions?: () => Promise<readonly GcSession[]>;
  /**
   * gascity-dashboard-ayr: injected fetchTriage so the /refresh failure
   * path can be exercised without spawning gh. When omitted, the route
   * uses the real implementation.
   */
  fetchTriage?: (repo: string) => Promise<MaintainerTriage>;
}

async function buildApp(opts: BuildOpts = {}): Promise<AppHandle> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sling-test-'));
  const auditPath = path.join(tmpDir, 'events.jsonl');
  setAuditLogPath(auditPath);

  const calls: SlingInput[] = [];
  // The supervisor's /sling returns a SlingResponse; root_bead_id is the
  // routed bead the route records in slung-state (replaces the old
  // ^Slung-stdout parse).
  const defaultStub: SlingStub = async (input) => ({
    root_bead_id: 'gc-255139',
    bead: 'gc-255139',
    target: input.target,
    status: 'ok',
  });
  const sling: SlingStub = async (input) => {
    calls.push(input);
    return (opts.sling ?? defaultStub)(input);
  };

  const app = express();
  app.use(express.json());
  // PR-B1 / specs/architecture/maintainer-coupling-audit.md C2: slungStatePath is now
  // required by maintainerRouter (defaultSlungStatePath removed). Mirror
  // slungStatePathFor() below so the test still writes to the same file
  // the router reads from.
  const routerOptions: Parameters<typeof maintainerRouter>[0] = {
    repo: 'gastownhall/gascity',
    cachePath: path.join(tmpDir, 'cache.json'),
    slungStatePath: path.join(tmpDir, 'slung-state.json'),
    slingTarget: opts.slingTarget ?? 'mayor',
    sling,
  };
  if (opts.triageTarget !== undefined) routerOptions.triageTarget = opts.triageTarget;
  if (opts.listSessions !== undefined) routerOptions.listSessions = opts.listSessions;
  if (opts.fetchTriage !== undefined) routerOptions.fetchTriage = opts.fetchTriage;
  app.use(
    '/api/maintainer',
    maintainerRouter(routerOptions),
  );

  return new Promise((resolve) => {
    const srv = app.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as AddressInfo).port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        auditPath,
        calls,
        close: () =>
          new Promise<void>((r) =>
            srv.close(async () => {
              await fs.rm(tmpDir, { recursive: true, force: true });
              r();
            }),
          ),
      });
    });
  });
}

async function postJson(
  url: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body: data };
}

async function readSseSome(
  res: globalThis.Response,
  minBytes: number,
  timeoutMs: number,
): Promise<string> {
  if (!res.body) throw new Error('no body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let acc = '';
  const deadline = Date.now() + timeoutMs;
  while (acc.length < minBytes) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const timer = new Promise<{ value?: undefined; done: true }>((r) =>
      setTimeout(() => r({ done: true }), remaining),
    );
    const next = await Promise.race([reader.read(), timer]);
    if (next.done || !next.value) break;
    acc += decoder.decode(next.value, { stream: true });
  }
  try {
    reader.releaseLock();
  } catch {
    // ignore
  }
  return acc;
}

async function readAudit(p: string): Promise<Array<Record<string, unknown>>> {
  try {
    const raw = await fs.readFile(p, 'utf-8');
    return raw
      .split('\n')
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  } catch {
    return [];
  }
}

describe('POST /api/maintainer/sling', { concurrency: false }, () => {
  let h: AppHandle;
  afterEach(async () => {
    if (h !== undefined) await h.close();
  });

  test('happy path: review intent dispatches and audits', async () => {
    h = await buildApp();
    const res = await postJson(`${h.url}/api/maintainer/sling`, {
      kind: 'pr',
      number: 47,
      html_url: 'https://github.com/gastownhall/gascity/pull/47',
      intent: 'review',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.bead_id, 'gc-255139');

    assert.equal(h.calls.length, 1);
    const call = h.calls[0]!;
    assert.equal(call.target, 'mayor');
    assert.equal(
      call.bead,
      'Please review PR https://github.com/gastownhall/gascity/pull/47',
    );

    const rows = await readAudit(h.auditPath);
    assert.equal(rows.length, 1);
    const row = rows[0]!;
    assert.equal(row.type, 'dashboard.sling');
    assert.equal(row.endpoint, 'POST /api/maintainer/sling');
    assert.equal(row.actor, 'stephanie');
    // gascity-dashboard-mq2: the HTTP sling has no subprocess exit code;
    // the success audit records duration only.
    assert.equal('exit_code' in row, false);
    assert.equal(typeof row.duration_ms, 'number');
    const parsed = row.parsed_args as Record<string, string>;
    assert.equal(parsed.kind, 'pr');
    assert.equal(parsed.number, '47');
    assert.equal(parsed.intent, 'review');
    assert.equal(parsed.target, 'mayor');
    assert.ok(Number(parsed.text_len) > 0, 'text_len should be positive');
    // Audit must NEVER carry the full bead text.
    const flat = JSON.stringify(row);
    assert.ok(!flat.includes('Please review PR'), 'audit row leaked full text');
    // Response must NOT carry the full stdout.
    assert.equal(res.body.stdout, undefined, 'response leaked stdout');
    assert.equal(res.body.stderr, undefined, 'response leaked stderr');
  });

  test('draft intent composes draft template', async () => {
    h = await buildApp();
    const res = await postJson(`${h.url}/api/maintainer/sling`, {
      kind: 'issue',
      number: 12,
      html_url: 'https://github.com/gastownhall/gascity/issues/12',
      intent: 'draft',
    });
    assert.equal(res.status, 200);
    assert.equal(h.calls.length, 1);
    assert.equal(
      h.calls[0]!.bead,
      'Please draft a PR addressing https://github.com/gastownhall/gascity/issues/12',
    );
  });

  test('triage intent composes triage template', async () => {
    h = await buildApp();
    const res = await postJson(`${h.url}/api/maintainer/sling`, {
      kind: 'pr',
      number: 99,
      html_url: 'https://github.com/gastownhall/gascity/pull/99',
      intent: 'triage',
    });
    assert.equal(res.status, 200);
    assert.equal(h.calls.length, 1);
    assert.equal(
      h.calls[0]!.bead,
      'Please triage https://github.com/gastownhall/gascity/pull/99',
    );
  });

  test('target falls back to configured slingTarget', async () => {
    h = await buildApp({ slingTarget: 'chief-of-staff' });
    const res = await postJson(`${h.url}/api/maintainer/sling`, {
      kind: 'pr',
      number: 1,
      html_url: 'https://github.com/gastownhall/gascity/pull/1',
      intent: 'review',
    });
    assert.equal(res.status, 200);
    assert.equal(h.calls[0]!.target, 'chief-of-staff');
  });

  test('explicit target overrides slingTarget', async () => {
    h = await buildApp({ slingTarget: 'mayor' });
    const res = await postJson(`${h.url}/api/maintainer/sling`, {
      kind: 'pr',
      number: 1,
      html_url: 'https://github.com/gastownhall/gascity/pull/1',
      intent: 'review',
      target: 'project-lead',
    });
    assert.equal(res.status, 200);
    assert.equal(h.calls[0]!.target, 'project-lead');
  });

  test('intent=triage with no explicit target uses triageTarget over slingTarget', async () => {
    // gascity-dashboard-0nn: bulk-sling action bar fans out a batch of
    // intent='triage' requests. The route picks the triage target so the
    // frontend doesn't have to know about chief-of-staff vs mayor.
    h = await buildApp({ slingTarget: 'mayor', triageTarget: 'chief-of-staff' });
    const res = await postJson(`${h.url}/api/maintainer/sling`, {
      kind: 'pr',
      number: 1,
      html_url: 'https://github.com/gastownhall/gascity/pull/1',
      intent: 'triage',
    });
    assert.equal(res.status, 200);
    assert.equal(h.calls[0]!.target, 'chief-of-staff');
  });

  test('intent=review with triageTarget set still uses slingTarget', async () => {
    // The triage override is intent-scoped; review/draft must stay on the
    // generic sling target.
    h = await buildApp({ slingTarget: 'mayor', triageTarget: 'chief-of-staff' });
    const res = await postJson(`${h.url}/api/maintainer/sling`, {
      kind: 'pr',
      number: 1,
      html_url: 'https://github.com/gastownhall/gascity/pull/1',
      intent: 'review',
    });
    assert.equal(res.status, 200);
    assert.equal(h.calls[0]!.target, 'mayor');
  });

  test('intent=triage with explicit target still wins over triageTarget', async () => {
    // Explicit body.target always trumps any config default, including
    // the intent-aware one.
    h = await buildApp({ slingTarget: 'mayor', triageTarget: 'chief-of-staff' });
    const res = await postJson(`${h.url}/api/maintainer/sling`, {
      kind: 'pr',
      number: 1,
      html_url: 'https://github.com/gastownhall/gascity/pull/1',
      intent: 'triage',
      target: 'project-lead',
    });
    assert.equal(res.status, 200);
    assert.equal(h.calls[0]!.target, 'project-lead');
  });

  test('intent=triage falls back to slingTarget when triageTarget option is unset', async () => {
    // Config fallback: a local app assembly that omits triageTarget still
    // dispatches to the configured default sling target.
    h = await buildApp({ slingTarget: 'mayor' });
    const res = await postJson(`${h.url}/api/maintainer/sling`, {
      kind: 'pr',
      number: 1,
      html_url: 'https://github.com/gastownhall/gascity/pull/1',
      intent: 'triage',
    });
    assert.equal(res.status, 200);
    assert.equal(h.calls[0]!.target, 'mayor');
  });

  test('invalid intent returns 400', async () => {
    h = await buildApp();
    const res = await postJson(`${h.url}/api/maintainer/sling`, {
      kind: 'pr',
      number: 1,
      html_url: 'https://github.com/gastownhall/gascity/pull/1',
      intent: 'destroy',
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.kind, 'validation');
    assert.equal(h.calls.length, 0);
  });

  test('invalid kind returns 400', async () => {
    h = await buildApp();
    const res = await postJson(`${h.url}/api/maintainer/sling`, {
      kind: 'epic',
      number: 1,
      html_url: 'https://github.com/gastownhall/gascity/pull/1',
      intent: 'review',
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.kind, 'validation');
    assert.equal(h.calls.length, 0);
  });

  test('invalid target alias returns 400', async () => {
    h = await buildApp();
    const res = await postJson(`${h.url}/api/maintainer/sling`, {
      kind: 'pr',
      number: 1,
      html_url: 'https://github.com/gastownhall/gascity/pull/1',
      intent: 'review',
      target: 'bad target!!',
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.kind, 'validation');
    assert.equal(h.calls.length, 0);
  });

  test('non-positive number returns 400', async () => {
    h = await buildApp();
    const res = await postJson(`${h.url}/api/maintainer/sling`, {
      kind: 'pr',
      number: 0,
      html_url: 'https://github.com/gastownhall/gascity/pull/0',
      intent: 'review',
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.kind, 'validation');
    assert.equal(h.calls.length, 0);
  });

  test('float number returns 400', async () => {
    h = await buildApp();
    const res = await postJson(`${h.url}/api/maintainer/sling`, {
      kind: 'pr',
      number: 1.5,
      html_url: 'https://github.com/gastownhall/gascity/pull/1',
      intent: 'review',
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.kind, 'validation');
    assert.equal(h.calls.length, 0);
  });

  test('kind=pr with /issues/ URL returns 400 mismatch', async () => {
    h = await buildApp();
    const res = await postJson(`${h.url}/api/maintainer/sling`, {
      kind: 'pr',
      number: 47,
      html_url: 'https://github.com/gastownhall/gascity/issues/47',
      intent: 'review',
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.kind, 'validation');
    assert.equal(h.calls.length, 0);
  });

  test('kind=issue with /pull/ URL returns 400 mismatch', async () => {
    h = await buildApp();
    const res = await postJson(`${h.url}/api/maintainer/sling`, {
      kind: 'issue',
      number: 12,
      html_url: 'https://github.com/gastownhall/gascity/pull/12',
      intent: 'draft',
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.kind, 'validation');
    assert.equal(h.calls.length, 0);
  });

  test('non-github html_url returns 400', async () => {
    h = await buildApp();
    const res = await postJson(`${h.url}/api/maintainer/sling`, {
      kind: 'pr',
      number: 1,
      html_url: 'https://evil.example.com/pull/1',
      intent: 'review',
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.kind, 'validation');
    assert.equal(h.calls.length, 0);
  });

  test('oversized html_url returns 400', async () => {
    h = await buildApp();
    const longSegment = 'a'.repeat(2_100);
    const res = await postJson(`${h.url}/api/maintainer/sling`, {
      kind: 'pr',
      number: 1,
      html_url: `https://github.com/gastownhall/gascity/pull/${longSegment}`,
      intent: 'review',
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.kind, 'validation');
    assert.equal(h.calls.length, 0);
  });

  // gascity-dashboard-mq2: the sling is an HTTP POST to the supervisor.
  // A non-2xx from the supervisor surfaces as GcClient throwing
  // `gc supervisor returned NNN` — that message can embed topology detail,
  // so the wire must carry only kind:'upstream' + details.name; the raw
  // message stays server-side (console.warn -> journalctl).
  test('supervisor non-2xx surfaces as 502 with redacted details (no raw message)', async () => {
    h = await buildApp({
      sling: async () => {
        // Mirrors GcClient.postJson on a non-ok response.
        throw new Error('gc supervisor returned 502');
      },
    });
    const res = await postJson(`${h.url}/api/maintainer/sling`, {
      kind: 'pr',
      number: 1,
      html_url: 'https://github.com/gastownhall/gascity/pull/1',
      intent: 'review',
    });
    assert.equal(res.status, 502);
    assert.equal(res.body.kind, 'upstream');
    // Only details.name (the Error class) reaches the wire — never the raw
    // message that could carry the supervisor status/topology.
    assert.deepEqual(res.body.details, { name: 'Error' });
    const serialised = JSON.stringify(res.body);
    assert.ok(!serialised.includes('supervisor returned'), 'response leaked raw upstream message');

    // gascity-dashboard-ur0: the throw still leaves a forensic audit row.
    const rows = await readAudit(h.auditPath);
    assert.equal(rows.length, 1);
    const parsed = rows[0]!.parsed_args as Record<string, string>;
    assert.equal(parsed.error_kind, 'upstream');
    assert.equal(parsed.target, 'mayor');
  });

  test('supervisor timeout surfaces as 504', async () => {
    h = await buildApp({
      sling: async () => {
        // GcClient.isTimeoutError keys on err.name === 'TimeoutError'
        // (AbortSignal.timeout fires a TimeoutError).
        const e = new Error('the operation timed out');
        e.name = 'TimeoutError';
        throw e;
      },
    });
    const res = await postJson(`${h.url}/api/maintainer/sling`, {
      kind: 'pr',
      number: 1,
      html_url: 'https://github.com/gastownhall/gascity/pull/1',
      intent: 'review',
    });
    assert.equal(res.status, 504);
    assert.equal(res.body.kind, 'upstream-timeout');
    assert.equal(h.calls.length, 1);

    // gascity-dashboard-ur0: timeouts are operationally significant — must
    // leave an audit trail so the operator can diagnose silent-failure
    // patterns from events.jsonl alone.
    const rows = await readAudit(h.auditPath);
    assert.equal(rows.length, 1);
    const parsed = rows[0]!.parsed_args as Record<string, string>;
    assert.equal(parsed.error_kind, 'timeout');
  });

  test('reads root_bead_id from the SlingResponse', async () => {
    h = await buildApp({
      sling: async () => ({ root_bead_id: 'gc-255139', bead: 'gc-other' }),
    });
    const res = await postJson(`${h.url}/api/maintainer/sling`, {
      kind: 'pr',
      number: 1,
      html_url: 'https://github.com/gastownhall/gascity/pull/1',
      intent: 'review',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    // root_bead_id wins over bead.
    assert.equal(res.body.bead_id, 'gc-255139');
  });

  test('falls back to bead when root_bead_id is absent', async () => {
    h = await buildApp({
      sling: async () => ({ bead: 'gc-abc' }),
    });
    const res = await postJson(`${h.url}/api/maintainer/sling`, {
      kind: 'pr',
      number: 1,
      html_url: 'https://github.com/gastownhall/gascity/pull/1',
      intent: 'review',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.bead_id, 'gc-abc');
  });

  test('omits bead_id when the response carries neither root_bead_id nor bead', async () => {
    h = await buildApp({
      sling: async () => ({ status: 'ok' }),
    });
    const res = await postJson(`${h.url}/api/maintainer/sling`, {
      kind: 'pr',
      number: 1,
      html_url: 'https://github.com/gastownhall/gascity/pull/1',
      intent: 'review',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.bead_id, undefined);
  });
});

// ── Slung-state persistence (gascity-dashboard-9qs) ──────────────────
//
// Successful slings must write the active-slung-state file so the
// next GET /triage's overlay can move the One Mark + render the
// inline run link. Failed slings must NOT write — slung state
// means "agent has the work."

function slungStatePathFor(handle: AppHandle): string {
  // Matches the slungStatePath threaded into routerOptions in buildApp:
  // sibling of the envelope cache in the test tmpDir. AppHandle exposes
  // the dir via auditPath (both live in the same tmpDir).
  return path.join(path.dirname(handle.auditPath), 'slung-state.json');
}

describe('POST /api/maintainer/sling — slung-state persistence', { concurrency: false }, () => {
  let h: AppHandle;
  afterEach(async () => {
    if (h !== undefined) await h.close();
  });

  test('success path writes a slung-state entry keyed by kind:number', async () => {
    h = await buildApp();
    const res = await postJson(`${h.url}/api/maintainer/sling`, {
      kind: 'pr',
      number: 47,
      html_url: 'https://github.com/gastownhall/gascity/pull/47',
      intent: 'triage',
    });
    assert.equal(res.status, 200);

    const state = await readSlungState(slungStatePathFor(h));
    const entry = state['pr:47'];
    assert.ok(entry, 'expected slung-state entry for pr:47');
    assert.equal(entry.target, 'mayor');
    assert.equal(entry.bead_id, 'gc-255139');
    assert.match(entry.slung_at, /^\d{4}-\d{2}-\d{2}T/);
  });

  test('success path persists bead_id: null when the response has no bead id', async () => {
    h = await buildApp({
      sling: async () => ({ status: 'ok' }),
    });
    const res = await postJson(`${h.url}/api/maintainer/sling`, {
      kind: 'issue',
      number: 99,
      html_url: 'https://github.com/gastownhall/gascity/issues/99',
      intent: 'triage',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.bead_id, undefined);

    const state = await readSlungState(slungStatePathFor(h));
    const entry = state['issue:99'];
    assert.ok(entry);
    assert.equal(entry.bead_id, null);
  });

  test('supervisor error does NOT write slung-state (sling failed)', async () => {
    h = await buildApp({
      sling: async () => {
        throw new Error('gc supervisor returned 502');
      },
    });
    const res = await postJson(`${h.url}/api/maintainer/sling`, {
      kind: 'pr',
      number: 12,
      html_url: 'https://github.com/gastownhall/gascity/pull/12',
      intent: 'triage',
    });
    assert.equal(res.status, 502);

    const state = await readSlungState(slungStatePathFor(h));
    assert.equal(state['pr:12'], undefined);
  });

  test('timeout does NOT write slung-state', async () => {
    h = await buildApp({
      sling: async () => {
        const e = new Error('the operation timed out');
        e.name = 'TimeoutError';
        throw e;
      },
    });
    const res = await postJson(`${h.url}/api/maintainer/sling`, {
      kind: 'pr',
      number: 13,
      html_url: 'https://github.com/gastownhall/gascity/pull/13',
      intent: 'triage',
    });
    assert.equal(res.status, 504);

    const state = await readSlungState(slungStatePathFor(h));
    assert.equal(state['pr:13'], undefined);
  });

  test('re-sling to same item overwrites existing entry with newer timestamp + target', async () => {
    h = await buildApp({ triageTarget: 'chief-of-staff' });
    await postJson(`${h.url}/api/maintainer/sling`, {
      kind: 'pr',
      number: 99,
      html_url: 'https://github.com/gastownhall/gascity/pull/99',
      intent: 'triage',
    });
    const firstState = await readSlungState(slungStatePathFor(h));
    const firstAt = firstState['pr:99']?.slung_at;
    assert.ok(firstAt);
    assert.equal(firstState['pr:99']?.target, 'chief-of-staff');

    // Re-sling with explicit override target.
    await new Promise((r) => setTimeout(r, 5));
    await postJson(`${h.url}/api/maintainer/sling`, {
      kind: 'pr',
      number: 99,
      html_url: 'https://github.com/gastownhall/gascity/pull/99',
      intent: 'triage',
      target: 'project-lead',
    });
    const secondState = await readSlungState(slungStatePathFor(h));
    const second = secondState['pr:99'];
    assert.ok(second, 'expected pr:99 entry after re-sling');
    assert.equal(second.target, 'project-lead');
    assert.ok(second.slung_at >= firstAt);
    assert.equal(Object.keys(secondState).length, 1);
  });

  test('successful sling fires the maintainer SSE refreshed event so frontends refetch within ~1s', async () => {
    h = await buildApp();
    // Open the SSE stream first so we don't miss the event.
    const ctrl = new AbortController();
    const stream = await fetch(`${h.url}/api/maintainer/events`, { signal: ctrl.signal });
    assert.equal(stream.status, 200);
    assert.equal(stream.headers.get('content-type'), 'text/event-stream');

    // Sling. The route's SSE hub should push to all open clients.
    const slingRes = await postJson(`${h.url}/api/maintainer/sling`, {
      kind: 'pr',
      number: 47,
      html_url: 'https://github.com/gastownhall/gascity/pull/47',
      intent: 'triage',
    });
    assert.equal(slingRes.status, 200);

    // Drain enough bytes to capture the refreshed event (initial `: hello`
    // comment + the `event: refreshed` line). 200 bytes is overkill for
    // both, 2s window covers slow CI.
    const body = await readSseSome(stream, 200, 2_000);
    ctrl.abort();
    assert.match(body, /event: refreshed/, 'expected an SSE refreshed event after a successful sling');
  });
});

// ── GET /api/maintainer/triage — slung overlay (gascity-dashboard-9qs) ──
//
// End-to-end: write a cached envelope where one PR is the marked
// candidate, sling that PR, then GET /triage and assert the maroon
// dot moved off the slung item onto the next candidate. This is the
// integration test that proves splice-at-read closes the regression.

// makePr now imported from ./fixtures/triage-item.js
// (gascity-dashboard-i8w). The shared fixture's defaults differ slightly
// from the local copy that lived here pre-i8w (status='open' vs
// 'needs_review', author.login differs,
// lines_changed=50 vs 100), but every test call site in this file
// either overrides what it asserts on or asserts on fields not affected
// by these defaults (is_marked, slung.target, slung.bead_id,
// slung.resolved_session_name).

function envelopeWithMarkedCandidates(items: TriageItem[]): MaintainerTriage {
  return {
    computed_at: '2026-05-24T00:00:00Z',
    repo: 'gastownhall/gascity',
    tiers: [
      { tier: 'regression_breaking', clusters: [], unclustered: items },
      { tier: 'regression', clusters: [], unclustered: [] },
      { tier: 'stability', clusters: [], unclustered: [] },
    ],
    totals: { issues_open: 0, prs_open: items.length },
  };
}

async function writeEnvelope(handle: AppHandle, envelope: MaintainerTriage): Promise<void> {
  await fs.writeFile(
    path.join(path.dirname(handle.auditPath), 'cache.json'),
    JSON.stringify(envelope, null, 2),
    'utf-8',
  );
}

describe('GET /api/maintainer/triage — slung overlay', { concurrency: false }, () => {
  let h: AppHandle;
  afterEach(async () => {
    if (h !== undefined) await h.close();
  });

  test('moves the One Mark off a slung PR onto the next candidate by sortScore', async () => {
    h = await buildApp();
    // Two regression_breaking PRs: 47 scores higher, would normally win
    // the mark. After slinging 47, the mark should land on 48.
    const top = makePr({ number: 47, triage_score: 320, lines_changed: 50 });
    const next = makePr({ number: 48, triage_score: 290, lines_changed: 200 });
    await writeEnvelope(h, envelopeWithMarkedCandidates([top, next]));

    // Pre-sling: cached envelope already has both marked candidates;
    // overlay's selectOneMark winnows to the top scorer (47).
    const before = await fetch(`${h.url}/api/maintainer/triage`).then((r) => r.json()) as MaintainerTriage;
    const beforeItems = before.tiers[0]!.unclustered;
    const marked = beforeItems.filter((it) => it.is_marked).map((it) => it.number);
    assert.deepEqual(marked, [47], 'pre-sling One Mark should be on 47');

    // Sling 47.
    const slingRes = await postJson(`${h.url}/api/maintainer/sling`, {
      kind: 'pr',
      number: 47,
      html_url: 'https://github.com/gastownhall/gascity/pull/47',
      intent: 'triage',
    });
    assert.equal(slingRes.status, 200);

    // GET overlay should now LIFT 47 out of its tier into slung_section
    // (gascity-dashboard-2yr) and put the mark on 48.
    const after = await fetch(`${h.url}/api/maintainer/triage`).then((r) => r.json()) as MaintainerTriage;
    const afterItems = after.tiers[0]!.unclustered;
    const nextMarked = afterItems.find((it) => it.number === 48);

    assert.equal(
      afterItems.find((it) => it.number === 47),
      undefined,
      'slung item 47 should be lifted out of its tier',
    );
    const slungItem = after.slung_section?.find((it) => it.number === 47);
    assert.ok(slungItem?.slung, 'item 47 should carry slung state in slung_section');
    assert.equal(slungItem!.slung.target, 'mayor');
    assert.equal(slungItem!.slung.bead_id, 'gc-255139');
    assert.equal(
      slungItem!.run_id,
      'gc-255139',
      'active-slung item stamps run_id from the persisted bead_id (gascity-dashboard-djpk)',
    );
    assert.equal(slungItem!.is_marked, false, 'slung item should not carry the mark');
    assert.equal(nextMarked?.is_marked, true, 'mark should move to the next candidate');
  });

  test('run_id is null on an active-slung item whose sling carried no bead id', async () => {
    h = await buildApp();
    await writeEnvelope(h, envelopeWithMarkedCandidates([makePr({ number: 90 })]));

    await writeSlungEntry(slungStatePathFor(h), slungKey('pr', 90), {
      slung_at: '2026-05-24T00:00:00Z',
      target: 'chief-of-staff',
      bead_id: null,
      resolved_session_name: null,
    });

    const env = await fetch(`${h.url}/api/maintainer/triage`).then((r) => r.json()) as MaintainerTriage;
    const item = env.slung_section?.find((it) => it.number === 90);
    assert.ok(item, 'item 90 present in slung_section');
    assert.equal(
      item!.run_id,
      null,
      'slung-but-no-bead → run_id is null (no run to link to yet)',
    );
  });

  test('run_id is absent (undefined) on a never-slung item', async () => {
    h = await buildApp();
    await writeEnvelope(h, envelopeWithMarkedCandidates([makePr({ number: 91 })]));

    const env = await fetch(`${h.url}/api/maintainer/triage`).then((r) => r.json()) as MaintainerTriage;
    const item = env.tiers[0]!.unclustered.find((it) => it.number === 91);
    assert.ok(item, 'item 91 present in its tier');
    assert.equal(
      item!.run_id,
      undefined,
      'never-slung item leaves run_id undefined (absent on the wire)',
    );
  });

  test('vetted item with stale slung-state entry: overlay forces slung=null', async () => {
    h = await buildApp();
    const vettedAndSlung = makePr({
      number: 50,
      triage_score: 280,
      triage_assessment: {
        vetted_score: 290,
        source: 'agent',
        notes: '',
        vetted_at: '2026-05-24T00:00:00Z',
      },
    });
    await writeEnvelope(h, envelopeWithMarkedCandidates([vettedAndSlung]));

    // Manually plant a stale slung-state entry (e.g. the worker sweep
    // hasn't purged it yet after the agent applied triage/vetted).
    await writeSlungEntry(slungStatePathFor(h), slungKey('pr', 50), {
      slung_at: '2026-05-23T00:00:00Z',
      target: 'chief-of-staff',
      bead_id: 'gc-stale',
      resolved_session_name: null,
    });

    const env = await fetch(`${h.url}/api/maintainer/triage`).then((r) => r.json()) as MaintainerTriage;
    const item = env.tiers[0]!.unclustered.find((it) => it.number === 50)!;
    assert.equal(item.slung, null, 'vetted-overrides-slung: overlay must zero out slung even if file says otherwise');
    // And the vetted item remains a mark candidate (it's not slung in the overlay's view).
    assert.equal(item.is_marked, true);
    // gascity-dashboard-djpk: the run-link stamp is gated on `active`, which is false
    // for a vetted-overridden item — so it must NOT carry a linkable run id even though
    // the stale slung-state entry above planted a bead_id ('gc-stale').
    assert.equal(
      item.run_id,
      undefined,
      'vetted-overrides-slung must not stamp run_id even when the stale entry has a bead_id',
    );
  });

  test('slung-state entry for an item no longer in the envelope: silently dropped, no error', async () => {
    h = await buildApp();
    await writeEnvelope(h, envelopeWithMarkedCandidates([makePr({ number: 60 })]));

    await writeSlungEntry(slungStatePathFor(h), slungKey('pr', 999), {
      slung_at: '2026-05-23T00:00:00Z',
      target: 'chief-of-staff',
      bead_id: 'gc-orphan',
      resolved_session_name: null,
    });

    const res = await fetch(`${h.url}/api/maintainer/triage`);
    assert.equal(res.status, 200);
    const env = await res.json() as MaintainerTriage;
    const item = env.tiers[0]!.unclustered.find((it) => it.number === 60)!;
    assert.equal(item.is_marked, true, 'item 60 still the mark; orphan slung-state for 999 is silently ignored');
    assert.deepEqual(env.slung_section, [], 'no active slings → empty section');
  });

  test('multiple slung items are all lifted into slung_section, newest first', async () => {
    h = await buildApp();
    await writeEnvelope(
      h,
      envelopeWithMarkedCandidates([
        makePr({ number: 70 }),
        makePr({ number: 71 }),
        makePr({ number: 72 }),
      ]),
    );

    // Plant three active slung entries with distinct slung_at so we can
    // assert the section is sorted newest-first.
    await writeSlungEntry(slungStatePathFor(h), slungKey('pr', 70), {
      slung_at: '2026-05-24T08:00:00Z',
      target: 'chief-of-staff',
      bead_id: 'gc-70',
      resolved_session_name: null,
    });
    await writeSlungEntry(slungStatePathFor(h), slungKey('pr', 71), {
      slung_at: '2026-05-24T10:00:00Z',
      target: 'chief-of-staff',
      bead_id: 'gc-71',
      resolved_session_name: null,
    });
    await writeSlungEntry(slungStatePathFor(h), slungKey('pr', 72), {
      slung_at: '2026-05-24T09:00:00Z',
      target: 'chief-of-staff',
      bead_id: 'gc-72',
      resolved_session_name: null,
    });

    const env = await fetch(`${h.url}/api/maintainer/triage`).then((r) => r.json()) as MaintainerTriage;

    assert.deepEqual(
      env.tiers[0]!.unclustered.map((it) => it.number),
      [],
      'all three slung items lifted out of the tier',
    );
    assert.deepEqual(
      env.slung_section?.map((it) => it.number),
      [71, 72, 70],
      'slung_section sorted by slung_at descending (newest batch on top)',
    );
    assert.ok(
      env.slung_section?.every((it) => it.slung != null),
      'every slung_section item carries non-null slung state',
    );
  });

  test('slung item inside a cluster is lifted out and the emptied cluster is dropped', async () => {
    h = await buildApp();
    const clustered = makePr({ number: 80, cluster_id: 'c1' });
    const envelope: MaintainerTriage = {
      computed_at: '2026-05-24T00:00:00Z',
      repo: 'gastownhall/gascity',
      tiers: [
        {
          tier: 'regression_breaking',
          clusters: [{ cluster_id: 'c1', files: ['a.go'], items: [clustered], lines_pending: 50 }],
          unclustered: [],
        },
        { tier: 'regression', clusters: [], unclustered: [] },
        { tier: 'stability', clusters: [], unclustered: [] },
      ],
      totals: { issues_open: 0, prs_open: 1 },
    };
    await writeEnvelope(h, envelope);

    await writeSlungEntry(slungStatePathFor(h), slungKey('pr', 80), {
      slung_at: '2026-05-24T00:00:00Z',
      target: 'chief-of-staff',
      bead_id: 'gc-80',
      resolved_session_name: null,
    });

    const env = await fetch(`${h.url}/api/maintainer/triage`).then((r) => r.json()) as MaintainerTriage;
    assert.deepEqual(env.tiers[0]!.clusters, [], 'cluster emptied by the lift is dropped');
    assert.deepEqual(
      env.slung_section?.map((it) => it.number),
      [80],
      'the clustered slung item moved to slung_section',
    );
  });

  test('corrupt triage cache returns an explicit server error, not an empty envelope', async () => {
    h = await buildApp();
    await fs.writeFile(
      path.join(path.dirname(h.auditPath), 'cache.json'),
      '{not-json',
      'utf-8',
    );

    const res = await fetch(`${h.url}/api/maintainer/triage`);
    assert.equal(res.status, 500);
    const body = (await res.json()) as { error?: string; kind?: string };
    assert.equal(body.kind, 'internal');
    assert.equal(body.error, 'maintainer triage cache unavailable');
  });
});

// ── GET /api/maintainer/contributor/:login — corrupt-cache regression
//    (gascity-dashboard-n8q3) ─────────────────────────────────────────
//
// PR #31 changed readCache from "returns CacheReadResult | null" to
// "returns CacheReadResult or THROWS on parse/shape failure". The /triage
// handler was updated with try/catch + routeInternalError; this contributor
// handler was missed. Express 4 does NOT auto-catch async rejections in
// route handlers, so the unhandled rejection bypasses error middleware and
// the request HANGS with no response. This regression pins the fixed
// behaviour: a corrupt cache returns a clean 500 mirroring /triage's
// envelope, and a missing cache (the supported "no cache yet" case)
// continues to return a 404.

describe('GET /api/maintainer/contributor/:login — corrupt cache', { concurrency: false }, () => {
  let h: AppHandle;
  afterEach(async () => {
    if (h !== undefined) await h.close();
  });

  test('corrupt cache returns a clean 500, not a hung request', async () => {
    h = await buildApp();
    await fs.writeFile(
      path.join(path.dirname(h.auditPath), 'cache.json'),
      '{not-json',
      'utf-8',
    );

    // AbortController guards the test runner against the pre-fix bug
    // where the request hangs indefinitely (the whole point of this
    // regression). A 2s ceiling is comfortably above the route's
    // measured latency on the corrupt-cache branch (single sync fs read
    // + sync JSON.parse throw + writeRouteError) and well under the
    // test runner's default timeout.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2_000);
    try {
      const res = await fetch(`${h.url}/api/maintainer/contributor/octocat`, {
        signal: ctrl.signal,
      });
      assert.equal(res.status, 500);
      const body = (await res.json()) as { error?: string; kind?: string };
      assert.equal(body.kind, 'internal');
      assert.equal(body.error, 'maintainer contributor cache unavailable');
    } finally {
      clearTimeout(timer);
    }
  });

  test('missing cache still returns 404 (not_found), not 500', async () => {
    // Pins that the missing-cache path stays the spec'd 404 and the
    // corrupt-cache fix didn't accidentally collapse "missing" into
    // "error". The status discriminant in CacheReadResult is the
    // contract between readCache and its callers.
    h = await buildApp();
    const res = await fetch(`${h.url}/api/maintainer/contributor/octocat`);
    assert.equal(res.status, 404);
    const body = (await res.json()) as { error?: string; kind?: string };
    assert.equal(body.kind, 'not_found');
  });
});

// ── Sling target role resolution (gascity-dashboard-55b) ────────────
//
// Sling POST resolves the configured target role to a concrete
// supervisor session_name at write time so the frontend's inline
// 'slung →' link lands on /agents/<session_name> instead of
// /agents/<role-label> (which 404s in AgentDetail's strict resolver).
//
// Tests pin both:
//   - happy path: listSessions returns a session carrying the role,
//     resolved_session_name persists on the slung-state entry.
//   - missing-session path: listSessions returns nothing matching the
//     role, resolved_session_name is null so the renderer surfaces
//     an inline error rather than a 404 link.
//   - failure path: listSessions throws, the sling itself still
//     succeeds and persists with resolved_session_name=null.

function fakeSession(overrides: Partial<GcSession> & { id: string }): GcSession {
  return {
    template: 't',
    state: 'active',
    created_at: '2026-05-24T00:00:00Z',
    attached: false,
    ...overrides,
  } as GcSession;
}

describe('POST /api/maintainer/sling — target role resolution (gascity-dashboard-55b)', { concurrency: false }, () => {
  let h: AppHandle;
  afterEach(async () => {
    if (h !== undefined) await h.close();
  });

  test('resolves chief-of-staff role to oversight-rig__chief-of-staff session_name', async () => {
    // Real-world fixture from the live supervisor: chief-of-staff is
    // configured as a pool agent under the oversight-rig.
    const cosSession = fakeSession({
      id: 'gc-255180',
      alias: 'oversight-rig.chief-of-staff',
      session_name: 'oversight-rig__chief-of-staff',
      pool: 'chief-of-staff',
      agent_kind: 'pool',
    });
    h = await buildApp({
      triageTarget: 'chief-of-staff',
      listSessions: async () => [cosSession],
    });
    const res = await postJson(`${h.url}/api/maintainer/sling`, {
      kind: 'pr',
      number: 2510,
      html_url: 'https://github.com/gastownhall/gascity/pull/2510',
      intent: 'triage',
    });
    assert.equal(res.status, 200);

    const state = await readSlungState(slungStatePathFor(h));
    const entry = state['pr:2510'];
    assert.ok(entry);
    // target stays as the configured role label (audit fidelity); the
    // RESOLVED slug is what the frontend builds the link from.
    assert.equal(entry.target, 'chief-of-staff');
    assert.equal(
      entry.resolved_session_name,
      'oversight-rig__chief-of-staff',
      'should resolve role to real session_name so AgentDetail finds it',
    );
  });

  test('persists resolved_session_name=null when no session matches the role', async () => {
    // Acceptance from the bug: 'If no session matches the configured
    // target role, UI shows clear inline "no session for role X" message
    // instead of producing a 404 link.' The renderer keys off
    // resolved_session_name being null/absent.
    h = await buildApp({
      triageTarget: 'chief-of-staff',
      listSessions: async () => [
        fakeSession({ id: 'gc-1', alias: 'unrelated', session_name: 'unrelated-session' }),
      ],
    });
    const res = await postJson(`${h.url}/api/maintainer/sling`, {
      kind: 'pr',
      number: 1,
      html_url: 'https://github.com/gastownhall/gascity/pull/1',
      intent: 'triage',
    });
    assert.equal(res.status, 200, 'sling itself must still succeed');

    const state = await readSlungState(slungStatePathFor(h));
    const entry = state['pr:1'];
    assert.ok(entry);
    assert.equal(entry.target, 'chief-of-staff');
    assert.equal(entry.resolved_session_name, null);
  });

  test('persists resolved_session_name=null when listSessions throws (supervisor down)', async () => {
    // Operational degradation: the sling routed successfully, but the
    // dashboard couldn't resolve the role for link-building. Should NOT
    // 5xx — the sling already worked. The link just renders as
    // 'no session for role' until the next sling refreshes it.
    h = await buildApp({
      triageTarget: 'chief-of-staff',
      listSessions: async () => {
        throw new Error('gc supervisor returned 502');
      },
    });
    const res = await postJson(`${h.url}/api/maintainer/sling`, {
      kind: 'pr',
      number: 1,
      html_url: 'https://github.com/gastownhall/gascity/pull/1',
      intent: 'triage',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);

    const state = await readSlungState(slungStatePathFor(h));
    const entry = state['pr:1'];
    assert.ok(entry);
    assert.equal(entry.resolved_session_name, null);
  });

  test('persists resolved_session_name=null when listSessions is not injected', async () => {
    // Production app assembly wires listSessions. This route-level unit
    // test keeps the dependency-injection boundary explicit.
    h = await buildApp({ triageTarget: 'chief-of-staff' });
    const res = await postJson(`${h.url}/api/maintainer/sling`, {
      kind: 'pr',
      number: 1,
      html_url: 'https://github.com/gastownhall/gascity/pull/1',
      intent: 'triage',
    });
    assert.equal(res.status, 200);

    const state = await readSlungState(slungStatePathFor(h));
    const entry = state['pr:1'];
    assert.ok(entry);
    assert.equal(entry.resolved_session_name, null);
  });

  test('explicit target body field also gets resolved (not just config defaults)', async () => {
    // A user-supplied body.target should also go through resolution so
    // the link is correct regardless of where the target value came from.
    const projectLead = fakeSession({
      id: 'gc-83263',
      alias: 'agent-diagnostics/oversight-rig.project-lead',
      session_name: 'agent-diagnostics--oversight-rig__project-lead',
      pool: 'project-lead',
    });
    h = await buildApp({
      listSessions: async () => [projectLead],
    });
    const res = await postJson(`${h.url}/api/maintainer/sling`, {
      kind: 'pr',
      number: 1,
      html_url: 'https://github.com/gastownhall/gascity/pull/1',
      intent: 'review',
      target: 'project-lead',
    });
    assert.equal(res.status, 200);
    const state = await readSlungState(slungStatePathFor(h));
    const entry = state['pr:1'];
    assert.equal(entry?.target, 'project-lead');
    assert.equal(entry?.resolved_session_name, 'agent-diagnostics--oversight-rig__project-lead');
  });

  test('overlay surfaces resolved_session_name on the rendered TriageItem.slung', async () => {
    // End-to-end: write a cached envelope, sling, then GET /triage and
    // confirm the item.slung field carries resolved_session_name through
    // the applySlungOverlay pipeline. The frontend reads this directly.
    const cos = fakeSession({
      id: 'gc-1',
      pool: 'chief-of-staff',
      session_name: 'oversight-rig__chief-of-staff',
    });
    h = await buildApp({
      triageTarget: 'chief-of-staff',
      listSessions: async () => [cos],
    });
    await writeEnvelope(h, envelopeWithMarkedCandidates([makePr({ number: 47 })]));

    await postJson(`${h.url}/api/maintainer/sling`, {
      kind: 'pr',
      number: 47,
      html_url: 'https://github.com/gastownhall/gascity/pull/47',
      intent: 'triage',
    });

    const env = (await fetch(`${h.url}/api/maintainer/triage`).then((r) => r.json())) as MaintainerTriage;
    // Slung items are lifted into slung_section (gascity-dashboard-2yr).
    const item = (env.slung_section ?? []).find((it) => it.number === 47);
    assert.ok(item, 'item 47 present in slung_section');
    assert.ok(item.slung);
    assert.equal(item.slung.resolved_session_name, 'oversight-rig__chief-of-staff');
  });
});

// gascity-dashboard-ayr: complete the sr6 redaction sweep. The /refresh
// route's non-ExecError catch arm previously emitted details.message
// containing whatever the underlying network error reported. err.name
// (Error class) is the only safe channel; full message is preserved
// in journalctl via console.warn. Mirrors the sessions/mail/beads
// 5xx redaction tests in routes.test.ts.
describe('POST /api/maintainer/refresh — err.message redaction', { concurrency: false }, () => {
  let h: AppHandle;
  afterEach(async () => {
    if (h !== undefined) await h.close();
  });

  test('502 response redacts raw err.message from non-ExecError failures', async () => {
    // Shape the thrown error to look like a fetch-level network failure
    // — that's the realistic threat (gh subprocess can also wrap
    // network errors that don't surface as ExecError). The redaction
    // contract: details.name is allowed; raw OS-detail substrings must
    // not slip through the response body.
    const leakyErr = new Error(
      'connect ECONNREFUSED 127.0.0.1:1 (interface lo) at /var/run/sock',
    );
    leakyErr.name = 'FetchError';
    h = await buildApp({
      fetchTriage: async () => {
        throw leakyErr;
      },
    });
    const res = await fetch(`${h.url}/api/maintainer/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(res.status, 502);
    const text = await res.text();
    const body = JSON.parse(text) as {
      kind?: string;
      details?: Record<string, string>;
    };
    assert.equal(body.kind, 'upstream');
    assert.equal(
      body.details?.message,
      undefined,
      'details.message must be redacted',
    );
    assert.equal(
      body.details?.name,
      'FetchError',
      'details.name must carry the Error class discriminator',
    );
    assert.ok(
      !text.includes('ECONNREFUSED'),
      `response leaks ECONNREFUSED: ${text}`,
    );
    assert.ok(
      !text.includes('127.0.0.1:1'),
      `response leaks upstream host:port: ${text}`,
    );
    assert.ok(
      !text.includes('/var/run/sock'),
      `response leaks file path: ${text}`,
    );
  });

  // gascity-dashboard-473: complete the sweep on the /refresh ExecError
  // arm. The spawn kind wraps "spawn <abs-path-to-gh> ENOENT" which
  // exposes the operator's PATH layout. validation/timeout pass through
  // (pre-authored safe messages by ExecError construction).
  test('502 response redacts spawn-arm host path from ExecError', async () => {
    h = await buildApp({
      fetchTriage: async () => {
        throw new ExecError(
          'spawn failed: spawn /home/ds/.local/bin/gh ENOENT',
          'spawn',
        );
      },
    });
    const res = await fetch(`${h.url}/api/maintainer/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    // ExecError 'spawn' kind maps to 502 in /refresh's status table.
    assert.equal(res.status, 502);
    const text = await res.text();
    const body = JSON.parse(text) as { kind?: string; error?: string };
    assert.equal(body.kind, 'spawn');
    assert.ok(
      !text.includes('/home/ds'),
      `response leaks operator home: ${text}`,
    );
    assert.ok(
      !text.includes('.local/bin'),
      `response leaks binary path: ${text}`,
    );
    assert.ok(
      !text.includes('ENOENT'),
      `response leaks OS errno: ${text}`,
    );
  });
});

// gascity-dashboard-473 / mq2: redaction sweep on the /sling catch arm.
// The sling now goes over HTTP, so a failure is a thrown Error (GcClient's
// `gc supervisor returned NNN`, or a raw fetch/network error). Its message
// can embed host/socket detail; only details.name (the Error class) may
// reach the wire — the full message stays server-side (console.warn).
describe('POST /api/maintainer/sling — err.message redaction', { concurrency: false }, () => {
  let h: AppHandle;
  afterEach(async () => {
    if (h !== undefined) await h.close();
  });

  test('upstream failure (502) redacts raw err.message host/socket detail', async () => {
    const leakyErr = new Error(
      'connect ECONNREFUSED 127.0.0.1:1 (interface lo) at /var/run/sock',
    );
    leakyErr.name = 'NetworkError';
    h = await buildApp({
      sling: async () => {
        throw leakyErr;
      },
    });
    const res = await postJson(`${h.url}/api/maintainer/sling`, {
      kind: 'pr',
      number: 1,
      html_url: 'https://github.com/gastownhall/gascity/pull/1',
      intent: 'review',
    });
    // Any non-timeout throw maps to 502 upstream (gascity-dashboard-mq2).
    assert.equal(res.status, 502);
    assert.equal(res.body.kind, 'upstream');
    assertWireDetails(res.body.details);
    assert.equal(res.body.details.message, undefined, 'details.message must be redacted');
    assert.equal(
      res.body.details.name,
      'NetworkError',
      'details.name must carry the Error class discriminator',
    );
    const wire = JSON.stringify(res.body);
    assert.ok(!wire.includes('ECONNREFUSED'), `response leaks ECONNREFUSED: ${wire}`);
    assert.ok(!wire.includes('/var/run/sock'), `response leaks file path: ${wire}`);
  });
});

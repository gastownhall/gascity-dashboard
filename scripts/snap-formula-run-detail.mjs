// Snap and smoke-test the formula run detail route with deterministic API data.
//
// Usage:
//   node scripts/snap-formula-run-detail.mjs
//   node scripts/snap-formula-run-detail.mjs dark
//   node scripts/snap-formula-run-detail.mjs --test
//   node scripts/snap-formula-run-detail.mjs --test light --inject-late-api-failure
//
// Starts at /runs, clicks the deterministic scoped lane, then validates
// the run detail view, active session evidence, partial snapshots, and
// historical-only transcripts. In --test mode, any dashboard API or supervisor
// proxy failure across the full journey fails the run.
//
// Output: /tmp/cp-snaps/<theme>-formula-run-detail*.png at 1440x900.

import { chromium } from 'playwright';
import { mkdir, readFile } from 'node:fs/promises';
import { argv, exit } from 'node:process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// BASE is env-configurable so an isolated worktree dev stack (its own
// backend PORT + a vite instance proxying /api to it on an alternate port)
// can be driven without touching the primary :5174 the user may be viewing.
// Default keeps the historic single-tree behaviour.
const BASE = process.env.SNAP_BASE || 'http://127.0.0.1:5174';
// gascity-dashboard-ucc: the dashboard is now city-scoped. The browser route
// carries a `/city/:cityName` basename and every city-scoped API call rides
// `/api/city/:cityName/*`. The harness navigates under this city and mocks
// the city-scoped request plane.
const CITY = 'racoon-city';
const CITY_BASE = `${BASE}/city/${CITY}`;
const OUT = '/tmp/cp-snaps';
const THEMES = ['light', 'dark'];
const TEST_MODE = argv.includes('--test');
const INJECT_LATE_API_FAILURE = argv.includes('--inject-late-api-failure');
const themeArg = argv.find((arg) => THEMES.includes(arg));
const wantThemes = themeArg ? [themeArg] : THEMES;
const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../frontend/src/test/fixtures/formula-run-detail.json',
);

const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));

await mkdir(OUT, { recursive: true });

async function runTheme(browser, theme) {
  const result = { theme, skipped: null, errors: [], info: {} };
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: theme,
    storageState: {
      cookies: [],
      origins: [{ origin: BASE, localStorage: [{ name: 'gascity:theme', value: theme }] }],
    },
  });
  await installApiFixtureRoutes(ctx);
  const page = await ctx.newPage();
  const apiCalls = [];
  const apiFailures = [];
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (isObservedApiPath(url.pathname)) {
      apiCalls.push({
        url: url.toString(),
        method: response.request().method(),
        status: response.status(),
      });
    }
  });
  page.on('requestfailed', (request) => {
    const url = new URL(request.url());
    if (isObservedApiPath(url.pathname)) {
      const failure = request.failure()?.errorText ?? 'request failed';
      // Rapid route changes legitimately cancel ambient requests that are no
      // longer needed. Keep HTTP status failures strict, but don't treat a
      // browser-side navigation cancellation as a broken API contract.
      if (failure === 'net::ERR_ABORTED') return;
      apiFailures.push({
        url: url.toString(),
        method: request.method(),
        failure,
      });
    }
  });

  try {
    try {
      await page.goto(`${CITY_BASE}/runs`, {
        waitUntil: 'domcontentloaded',
        timeout: 5_000,
      });
    } catch (err) {
      if (String(err).includes('ERR_CONNECTION_REFUSED') || String(err).includes('net::ERR')) {
        result.skipped = 'no-frontend';
        return result;
      }
      throw err;
    }

    const summaryLane = page.getByRole('link', { name: /adopt pr #42/i });
    await summaryLane.waitFor({ timeout: 5_000 });
    await summaryLane.click();
    await page.waitForURL(
      `${CITY_BASE}/runs/gc-adopt-pr-active?scope_kind=city&scope_ref=racoon-city`,
      { timeout: 5_000 },
    );
    await page.getByRole('heading', { name: /adopt pr #42/i }).waitFor({ timeout: 5_000 });
    await page.getByText(/v11 · seq 91/i).waitFor({ timeout: 5_000 });
    await page.getByRole('heading', { name: /formula graph/i }).waitFor({ timeout: 5_000 });
    await page.getByRole('heading', { name: /local changes/i }).waitFor({ timeout: 5_000 });
    await page
      .getByText('preserve failed attempt transcript links', { exact: true })
      .waitFor({ timeout: 5_000 });
    await page.getByText('old session guard').waitFor({ timeout: 5_000 });
    // Related section (gascity-dashboard-j4x) — RK3 density gate. The
    // high-volume fixture (40 molecule members + 3 unresolved links) must
    // render exactly one aggregate maroon mark in the Related section, cap
    // rows per group with a `+ N more`, and pass the greyscale test (every
    // state still readable without colour).
    const relatedHeading = page.getByRole('heading', { name: /^related$/i });
    await relatedHeading.waitFor({ timeout: 5_000 });
    await page.getByText(/40 resolved, 3 unresolved/i).waitFor({ timeout: 5_000 });
    // One Mark Rule: at most one maroon (the .text-accent class) on the
    // Related section once its summary line crosses the unresolved threshold.
    const relatedSection = page.locator('section').filter({ has: relatedHeading });
    const maroonCount = await relatedSection.locator('.text-accent').count();
    if (maroonCount > 1) {
      result.errors.push(`Related section broke the One Mark Rule, maroon count=${maroonCount}`);
    }
    await page.getByRole('button', { name: /show detail/i }).click();
    // Density: the 40-member molecule group must collapse to a `+ N more`.
    await page.getByText(/\+ \d+ more/i).waitFor({ timeout: 5_000 });
    await page.getByRole('button', { name: /hide detail/i }).click();

    await page.getByRole('tab', { name: /session/i }).click();
    await page.getByText(/select a node/i).waitFor({ timeout: 5_000 });

    const reviewNode = page.getByRole('button', { name: /multi-model review pipeline/i });
    const initiallySelected = await reviewNode.getAttribute('aria-pressed');
    if (initiallySelected !== 'false') {
      result.errors.push(`review-pipeline started selected, aria-pressed=${initiallySelected}`);
    }

    await reviewNode.click();
    await page.getByText(/checking graph\.v2 node grouping/i).waitFor({ timeout: 5_000 });
    await page
      .getByText(/streaming: preserving active-session progress/i)
      .waitFor({ timeout: 5_000 });
    await page.getByRole('radio', { name: /iteration 1/i }).click();
    await page.getByText(/found two issues/i).waitFor({ timeout: 5_000 });
    await page.getByText(/^historical$/i).waitFor({ timeout: 5_000 });
    await expectTextCount(
      page.getByText(/streaming: preserving active-session progress/i),
      0,
      result,
      'historical iteration unexpectedly kept the active session stream text visible',
    );
    await page.getByRole('radio', { name: /iteration 2/i }).click();
    await page.getByText(/checking graph\.v2 node grouping/i).waitFor({ timeout: 5_000 });
    await page
      .getByText(/streaming: preserving active-session progress/i)
      .waitFor({ timeout: 5_000 });
    await page.waitForTimeout(300);

    const selected = await page
      .getByRole('button', { name: /multi-model review pipeline/i })
      .getAttribute('aria-pressed');
    if (selected !== 'true') {
      result.errors.push(`review-pipeline was not selected, aria-pressed=${selected}`);
    }

    const snapPath = `${OUT}/${theme}-formula-run-detail.png`;
    await page.screenshot({ path: snapPath, fullPage: false });
    result.info.snap = snapPath;

    await reviewNode.click();
    await page.getByText(/select a node/i).waitFor({ timeout: 5_000 });
    const cleared = await reviewNode.getAttribute('aria-pressed');
    if (cleared !== 'false') {
      result.errors.push(`review-pipeline did not toggle off, aria-pressed=${cleared}`);
    }

    await reviewNode.focus();
    await page.keyboard.press('Enter');
    await page.getByText(/checking graph\.v2 node grouping/i).waitFor({ timeout: 5_000 });
    const keyboardSelected = await reviewNode.getAttribute('aria-pressed');
    if (keyboardSelected !== 'true') {
      result.errors.push(`Enter did not select review-pipeline, aria-pressed=${keyboardSelected}`);
    }
    await page.keyboard.press('Escape');
    await page.getByText(/select a node/i).waitFor({ timeout: 5_000 });
    const escapeCleared = await reviewNode.getAttribute('aria-pressed');
    if (escapeCleared !== 'false') {
      result.errors.push(`Escape did not clear review-pipeline, aria-pressed=${escapeCleared}`);
    }

    await page.getByRole('button', { name: /pre-approval ci repair loop/i }).click();
    await page.getByText(/session unresolved for this node/i).waitFor({ timeout: 5_000 });

    await page.goto(`${CITY_BASE}/runs/gc-adopt-pr-partial`, {
      waitUntil: 'domcontentloaded',
      timeout: 5_000,
    });
    await page.getByText(/partial run data/i).waitFor({ timeout: 5_000 });

    await page.goto(`${CITY_BASE}/runs/gc-adopt-pr-active?node=old-only-review`, {
      waitUntil: 'domcontentloaded',
      timeout: 5_000,
    });
    await page.getByRole('tab', { name: /session/i }).click();
    await page.getByText(/historical-only/i).waitFor({ timeout: 5_000 });
    await page.getByText(/found two issues/i).waitFor({ timeout: 5_000 });
    const hiddenCount = await page.getByRole('button', { name: /old-only review/i }).count();
    if (hiddenCount !== 0) {
      result.errors.push(`historical-only node rendered in graph, count=${hiddenCount}`);
    }
    const hiddenSnapPath = `${OUT}/${theme}-formula-run-detail-historical-only.png`;
    await page.screenshot({ path: hiddenSnapPath, fullPage: false });
    result.info.hiddenSnap = hiddenSnapPath;

    await page.goto(`${CITY_BASE}/runs/gc-no-graph`, {
      waitUntil: 'domcontentloaded',
      timeout: 5_000,
    });
    await page.getByText(/run is not a graph\.v2 run/i).waitFor({ timeout: 5_000 });

    await page.goto(`${CITY_BASE}/runs/gc-not-git`, {
      waitUntil: 'domcontentloaded',
      timeout: 5_000,
    });
    await page.getByRole('tab', { name: /diff/i }).click();
    await page.getByText(/not a git work tree/i).waitFor({ timeout: 5_000 });

    await page.goto(`${CITY_BASE}/runs/gc-path-unknown`, {
      waitUntil: 'domcontentloaded',
      timeout: 5_000,
    });
    await page.getByRole('tab', { name: /diff/i }).click();
    await page.getByText(/execution folder is unknown/i).waitFor({ timeout: 5_000 });

    await page.goto(`${CITY_BASE}/runs/gc-clean-worktree`, {
      waitUntil: 'domcontentloaded',
      timeout: 5_000,
    });
    await page.getByRole('tab', { name: /diff/i }).click();
    await page.getByText(/no renderable patch/i).waitFor({ timeout: 5_000 });

    recordApiFailures(result, apiCalls, apiFailures);
    result.info.apiCalls = apiCalls;
    result.info.apiFailures = apiFailures;
  } finally {
    await ctx.close();
  }

  return result;
}

async function expectTextCount(locator, expected, result, message) {
  const count = await locator.count();
  if (count !== expected) result.errors.push(`${message}, count=${count}`);
}

function recordApiFailures(result, apiCalls, apiFailures) {
  const failedApiCalls = apiCalls.filter((call) => call.status >= 400);
  if (failedApiCalls.length > 0) {
    result.errors.push(
      `unexpected API failures: ${failedApiCalls
        .map((call) => `${call.status} ${call.url}`)
        .join('; ')}`,
    );
  }
  if (apiFailures.length > 0) {
    result.errors.push(
      `unexpected API request failures: ${apiFailures
        .map((call) => `${call.method} ${call.url} (${call.failure})`)
        .join('; ')}`,
    );
  }
}

async function installApiFixtureRoutes(context) {
  // The city switcher (Header) lists managed cities directly through the
  // supervisor transport proxy. Mock it so the harness needs no live supervisor.
  await context.route('**/gc-supervisor/v0/cities', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [{ name: CITY, running: true }],
        total: 1,
      }),
    });
  });

  // Dashboard-local city-scoped endpoints ride `/api/city/:cityName/*`.
  // Supervisor-owned reads use `/gc-supervisor/v0/city/:cityName/*`.
  await context.route('**/gc-supervisor/v0/city/*/beads**', async (route) => {
    const url = new URL(route.request().url());
    const limit = url.searchParams.get('limit');
    const type = url.searchParams.get('type');
    const items = limit === '5000' && type === null
      ? highVolumeLinkBeads()
      : type === null
        ? [runRootBeadFixture()]
        : [];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items,
        partial: false,
        total: items.length,
      }),
    });
  });

  await context.route('**/gc-supervisor/v0/city/*/events/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
      },
      body: 'retry: 60000\n: formula run detail fixture\n\n',
    });
  });

  await context.route('**/api/city/*/config', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        cityName: 'racoon-city',
        cityRoot: '/tmp/gascity',
        useFixtures: false,
      }),
    });
  });

  await context.route('**/api/client-errors', async (route) => {
    await route.fulfill({
      status: 204,
      body: '',
    });
  });

  await context.route('**/api/city/*/runs/gc-adopt-pr-partial/diff**', async (route) => {
    if (INJECT_LATE_API_FAILURE && route.request().url().includes('/diff')) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'injected late diff failure' }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(fixture.diff),
    });
  });

  await context.route('**/api/city/*/runs/gc-adopt-pr-active/diff**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(fixture.diff),
    });
  });

  await context.route('**/api/city/*/runs/gc-no-graph/diff**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(fixture.diff),
    });
  });

  await context.route('**/api/city/*/runs/gc-not-git/diff**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(unavailableDiff('not_git')),
    });
  });

  await context.route('**/api/city/*/runs/gc-path-unknown/diff**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(unavailableDiff('path_unknown')),
    });
  });

  await context.route('**/api/city/*/runs/gc-clean-worktree/diff**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(cleanWorktreeDiff()),
    });
  });

  await context.route('**/gc-supervisor/v0/city/*/workflow/**', async (route) => {
    const runId = workflowRunId(route.request().url());
    if (runId === 'gc-no-graph') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(workflowSnapshot({ ...fixture.detail, runId }, { graph: false })),
      });
      return;
    }
    const partial = runId === 'gc-adopt-pr-partial';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(workflowSnapshot(
        {
          ...fixture.detail,
          runId,
          completeness: partial
            ? { kind: 'partial', reasons: ['supervisor_snapshot_partial'] }
            : fixture.detail.completeness,
        },
        { partial },
      )),
    });
  });

  await context.route('**/gc-supervisor/v0/city/*/formulas/**', async (route) => {
    if (new URL(route.request().url()).pathname.endsWith('/formulas/feed')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(formulaFeedFixture()),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(formulaDetailFixture()),
    });
  });

  await context.route('**/gc-supervisor/v0/city/*/sessions', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(sessionListFixture()),
    });
  });

  await context.route('**/gc-supervisor/v0/city/*/session/*/transcript**', async (route) => {
    const sessionId = route
      .request()
      .url()
      .match(/\/gc-supervisor\/v0\/city\/[^/]+\/session\/([^/]+)\/transcript(?:\?|$)/)?.[1];
    const transcript = sessionId ? fixture.transcripts[decodeURIComponent(sessionId)] : null;
    if (!transcript) {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'missing transcript fixture' }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(toSupervisorTranscript(transcript)),
    });
  });

  await context.route('**/gc-supervisor/v0/city/*/session/*/stream', async (route) => {
    const sessionId = route
      .request()
      .url()
      .match(/\/gc-supervisor\/v0\/city\/[^/]+\/session\/([^/]+)\/stream(?:\?|$)/)?.[1];
    const turns = sessionId ? fixture.streamTurns[decodeURIComponent(sessionId)] ?? [] : [];
    const body = turns
      .map((turn) => `event: turn\ndata: ${JSON.stringify(turn)}\n\n`)
      .join('');
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
      },
      body,
    });
  });
}

function isObservedApiPath(pathname) {
  if (pathname === '/api/client-errors') return false;
  return pathname.startsWith('/api/') || pathname.startsWith('/gc-supervisor/');
}

function toSupervisorTranscript(transcript) {
  return {
    id: transcript.session_id,
    template: transcript.template ?? '',
    provider: transcript.provider ?? '',
    format: transcript.format ?? 'conversation',
    turns: transcript.turns,
  };
}

function unavailableDiff(kind) {
  return {
    kind,
    rootPath: { kind: 'unavailable', reason: kind },
    comparison: { kind: 'unavailable', reason: kind },
    status: [],
    changedFiles: [],
    patch: '',
    truncated: false,
  };
}

function cleanWorktreeDiff() {
  return {
    kind: 'ok',
    rootPath: { kind: 'known', path: '/tmp/gascity/adopt-pr-42' },
    comparison: { kind: 'head', reason: 'no_upstream' },
    status: [],
    changedFiles: [],
    patch: '',
    truncated: false,
  };
}

function workflowRunId(url) {
  return decodeURIComponent(
    new URL(url).pathname.match(/\/workflow\/([^/?#]+)/)?.[1] ?? 'gc-adopt-pr-active',
  );
}

function workflowSnapshot(detail, options = {}) {
  const graph = options.graph !== false;
  const snapshot = {
    workflow_id: detail.runId,
    root_bead_id: detail.runId,
    root_store_ref: detail.rootStoreRef,
    resolved_root_store: detail.resolvedRootStore,
    scope_kind: detail.scopeKind,
    scope_ref: detail.scopeRef,
    snapshot_version: detail.snapshotVersion,
    partial: options.partial ?? detail.completeness.kind === 'partial',
    stores_scanned: [detail.rootStoreRef],
    beads: workflowBeads(detail, graph),
    deps: detail.edges,
    logical_nodes: [],
    logical_edges: detail.edges,
    scope_groups: [],
  };
  if (detail.snapshotEventSeq.kind === 'known') {
    snapshot.snapshot_event_seq = detail.snapshotEventSeq.seq;
  }
  return snapshot;
}

function workflowBeads(detail, graph) {
  const beads = [];
  for (const node of detail.nodes) {
    for (const instance of node.executionInstances) {
      beads.push(workflowBead(detail, node, instance, graph));
    }
    for (const badge of node.controlBadges ?? []) {
      beads.push(controlBead(detail, node, badge));
    }
  }
  return beads;
}

function workflowBead(detail, node, instance, graph) {
  const isRoot = node.semanticNodeId === detail.rootBeadId;
  const id = isRoot ? detail.runId : instance.beadId;
  const metadata = {
    'gc.kind': workflowKind(node.constructKind),
    'gc.step_id': node.semanticNodeId,
    'gc.step_ref': stepRefFor(node, instance),
  };
  if (isRoot) {
    metadata['gc.scope_kind'] = detail.scopeKind;
    metadata['gc.scope_ref'] = detail.scopeRef;
    metadata['gc.root_store_ref'] = detail.rootStoreRef;
    if (detail.executionPath.kind === 'known') {
      metadata['gc.work_dir'] = detail.executionPath.path;
    }
    if (graph) {
      metadata['gc.formula_contract'] = 'graph.v2';
      metadata['gc.formula'] = 'mol-adopt-pr-v2';
      metadata['gc.run_target'] = 'racoon-city/codex';
    }
  } else {
    metadata['gc.logical_bead_id'] = node.semanticNodeId;
  }
  if (node.scope.kind === 'scoped') {
    metadata['gc.scope_ref'] = node.scope.ref;
  }
  if (instance.iteration.kind === 'loop') {
    metadata['gc.iteration'] = String(instance.iteration.value);
  }
  if (instance.attempt.kind === 'attempt') {
    metadata['gc.attempt'] = String(instance.attempt.value);
  }
  const maxAttempts = maxAttemptsFor(node);
  if (maxAttempts !== null) {
    metadata['gc.max_attempts'] = String(maxAttempts);
  }
  if (instance.session.kind === 'attached') {
    metadata['gc.session_id'] = instance.session.link.sessionId;
    metadata['session_name'] = instance.session.link.sessionName;
  }

  return {
    id,
    title: node.title,
    status: supervisorStatus(instance.status),
    kind: workflowKind(node.constructKind),
    step_ref: metadata['gc.step_ref'],
    ...(instance.attempt.kind === 'attempt' ? { attempt: instance.attempt.value } : {}),
    ...(isRoot ? {} : { logical_bead_id: node.semanticNodeId }),
    ...(node.scope.kind === 'scoped' ? { scope_ref: node.scope.ref } : {}),
    ...(instance.session.kind === 'attached'
      ? { assignee: instance.session.link.assignee }
      : {}),
    metadata,
  };
}

function controlBead(detail, node, badge) {
  return {
    id: badge.id,
    title: badge.label,
    status: supervisorStatus(badge.status),
    kind: 'run-finalize',
    step_ref: `${node.semanticNodeId}.${badge.label}`,
    logical_bead_id: node.semanticNodeId,
    metadata: {
      'gc.kind': 'run-finalize',
      'gc.control_for': node.semanticNodeId === detail.rootBeadId ? detail.runId : node.semanticNodeId,
      'gc.step_id': badge.id,
      'gc.step_ref': `${node.semanticNodeId}.${badge.label}`,
    },
  };
}

function workflowKind(constructKind) {
  return constructKind === 'check-loop' ? 'ralph' : constructKind;
}

function stepRefFor(node, instance) {
  if (node.semanticNodeId === fixture.detail.rootBeadId) {
    return node.semanticNodeId;
  }
  if (instance.iteration.kind === 'loop' && node.iterationSummary.control.kind === 'known') {
    return `${node.iterationSummary.control.id}.iteration.${instance.iteration.value}.${node.semanticNodeId}`;
  }
  if (instance.attempt.kind === 'attempt') {
    return `${node.semanticNodeId}.attempt.${instance.attempt.value}`;
  }
  return node.semanticNodeId;
}

function maxAttemptsFor(node) {
  if (node.attemptSummary.kind !== 'tracked') return null;
  if (node.attemptSummary.badge.kind !== 'bounded') return null;
  const max = Number.parseInt(node.attemptSummary.badge.label.split('/')[1] ?? '', 10);
  return Number.isSafeInteger(max) && max > 0 ? max : null;
}

function supervisorStatus(status) {
  switch (status) {
    case 'active':
    case 'running':
      return 'in_progress';
    case 'completed':
    case 'done':
      return 'closed';
    case 'ready':
    case 'blocked':
    case 'failed':
    case 'skipped':
      return status;
    case 'pending':
    default:
      return 'open';
  }
}

function formulaDetailFixture() {
  const nodes = fixture.detail.nodes
    .filter((node) => node.constructKind !== 'run-root')
    .map((node) => ({
      id: node.semanticNodeId,
      title: node.title,
      kind: node.constructKind,
    }));
  return {
    name: 'mol-adopt-pr-v2',
    description: 'Fixture formula detail for the direct supervisor smoke.',
    version: 'fixture',
    preview: {
      nodes,
      edges: fixture.detail.edges,
    },
    steps: nodes,
    deps: fixture.detail.edges,
    var_defs: [],
  };
}

function sessionListFixture() {
  const sessions = new Map();
  for (const node of fixture.detail.nodes) {
    for (const instance of node.executionInstances) {
      if (instance.session.kind !== 'attached') continue;
      const link = instance.session.link;
      sessions.set(link.sessionId, {
        id: link.sessionId,
        template: link.sessionName,
        title: link.sessionName,
        provider: 'codex',
        session_name: link.sessionName,
        state: instance.session.streamable ? 'active' : 'closed',
        created_at: '2026-05-24T10:00:00.000Z',
        attached: true,
        running: instance.session.streamable,
        alias: link.sessionName,
        last_active: '2026-05-24T11:00:00.000Z',
      });
    }
  }
  return {
    items: [...sessions.values()],
    partial: false,
    total: sessions.size,
  };
}

function runRootBeadFixture() {
  return {
    id: 'gc-adopt-pr-active',
    title: 'Adopt PR #42',
    status: 'in_progress',
    issue_type: 'molecule',
    priority: null,
    created_at: '2026-05-25T00:00:00.000Z',
    updated_at: '2026-05-25T00:00:00.000Z',
    metadata: {
      'gc.kind': 'run',
      'gc.formula': 'mol-adopt-pr-v2',
      'gc.formula_contract': 'graph.v2',
      'gc.scope_kind': 'city',
      'gc.scope_ref': CITY,
      'gc.root_store_ref': `city:${CITY}`,
      'gc.root_bead_id': 'gc-adopt-pr-active',
      'gc.parent_bead_id': 'missing-parent',
      'gc.run_target': `${CITY}/codex`,
      molecule_id: 'gc-adopt-pr-active',
      'evidence.pr_number': '42',
      'evidence.pr_url': 'https://github.com/gastownhall/gascity-dashboard/pull/42',
      'pr_review.pr_number': '42',
      'pr_review.pr_url': 'https://github.com/gastownhall/gascity-dashboard/pull/42',
      'bugflow.github_issue_number': '7',
    },
  };
}

function formulaFeedFixture() {
  return {
    items: [
      {
        id: 'gc-adopt-pr-active',
        workflow_id: 'gc-adopt-pr-active',
        root_bead_id: 'gc-adopt-pr-active',
        root_store_ref: `city:${CITY}`,
        scope_kind: 'city',
        scope_ref: CITY,
        started_at: '2026-05-25T00:00:00.000Z',
        status: 'running',
        target: `${CITY}/codex`,
        title: 'Adopt PR #42',
        type: 'formula',
        updated_at: '2026-05-25T00:00:00.000Z',
        run_detail_available: true,
        detail_available: true,
      },
    ],
    partial: false,
  };
}

function highVolumeLinkBeads() {
  const beads = [runRootBeadFixture()];
  for (let i = 0; i < 40; i += 1) {
    beads.push({
      id: `gc-step-${i}`,
      title: `step ${i}`,
      status: 'closed',
      issue_type: 'task',
      priority: null,
      created_at: '2026-05-25T00:00:00.000Z',
      updated_at: '2026-05-25T00:00:00.000Z',
      metadata: {
        'gc.kind': 'step',
        'gc.scope_kind': 'city',
        'gc.scope_ref': CITY,
        molecule_id: 'gc-adopt-pr-active',
      },
    });
  }
  return beads;
}

const browser = await chromium.launch();
const results = [];
try {
  for (const theme of wantThemes) {
    results.push(await runTheme(browser, theme));
  }
} finally {
  await browser.close();
}

let hadErrors = false;
for (const result of results) {
  if (result.skipped === 'no-frontend') {
    console.log(`[${result.theme}] SKIP, frontend not reachable at ${BASE}`);
    continue;
  }
  if (result.info.snap) console.log(`[${result.theme}] snap ${result.info.snap}`);
  if (result.info.hiddenSnap) {
    console.log(`[${result.theme}] snap ${result.info.hiddenSnap}`);
  }
  if (TEST_MODE) {
    for (const call of result.info.apiCalls ?? []) {
      console.log(`[${result.theme}] api ${call.status} ${call.method} ${call.url}`);
    }
    for (const call of result.info.apiFailures ?? []) {
      console.log(`[${result.theme}] api failed ${call.method} ${call.url} (${call.failure})`);
    }
  }
  if (result.errors.length > 0) {
    hadErrors = true;
    for (const error of result.errors) console.error(`[${result.theme}] FAIL, ${error}`);
  } else if (TEST_MODE) {
    console.log(`[${result.theme}] PASS`);
  }
}

if (TEST_MODE) {
  if (hadErrors) {
    console.error('formula run detail snapshot: FAILED');
    exit(1);
  }
  const ranAny = results.some((result) => result.skipped === null);
  if (!ranAny) {
    console.log('formula run detail snapshot: SKIPPED (no live frontend)');
    exit(0);
  }
  console.log('formula run detail snapshot: PASSED');
}

// Live sample-city smoke test for graph.v2 formula run detail.
//
// This intentionally hits the running dashboard and supervisor-backed APIs.
// It verifies that the sample todo and tic-tac-toe planning and implementation
// runs are present, clickable from /runs, and render as real run-detail pages
// with browser-owned progress, graph selection, diff evidence, and session
// empty/state handling.
//
// Usage:
//   node scripts/e2e-sample-formula-runs.mjs
//
// Optional:
//   DASHBOARD_BASE_URL=http://127.0.0.1:5174 DASHBOARD_CITY=formula-detail-demo-city node scripts/e2e-sample-formula-runs.mjs

import { chromium } from 'playwright';
import { exit } from 'node:process';

const BASE = stripTrailingSlash(process.env.DASHBOARD_BASE_URL ?? 'http://127.0.0.1:5174');
const CITY = process.env.DASHBOARD_CITY ?? await discoverFirstCity(BASE);
const CITY_BASE = `${BASE}/city/${encodeURIComponent(CITY)}`;
const EXPECTED_RUNS = [
  {
    key: 'todo planning',
    scopeKind: 'rig',
    scopeRef: 'todo-app',
    title: /plan\b.*todo/i,
  },
  {
    key: 'todo implementation',
    scopeKind: 'rig',
    scopeRef: 'todo-app',
    title: /implement|implementation/i,
  },
  {
    key: 'tic-tac-toe planning',
    scopeKind: 'rig',
    scopeRef: 'tic-tac-toe-app',
    title: /plan\b.*tic tac toe/i,
  },
  {
    key: 'tic-tac-toe implementation',
    scopeKind: 'rig',
    scopeRef: 'tic-tac-toe-app',
    title: /implement|implementation/i,
  },
];

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: 'light',
  storageState: {
    cookies: [],
    origins: [
      {
        origin: BASE,
        localStorage: [{ name: 'gascity:theme', value: 'light' }],
      },
    ],
  },
});

const page = await context.newPage();
const errors = [];
const apiCalls = [];
const apiFailures = [];

page.on('response', (response) => {
  const url = new URL(response.url());
  if (isObservedApiPath(url.pathname)) {
    apiCalls.push({
      status: response.status(),
      method: response.request().method(),
      url: url.toString(),
    });
  }
});

page.on('requestfailed', (request) => {
  const url = new URL(request.url());
  if (!isObservedApiPath(url.pathname)) return;
  const failure = request.failure()?.errorText ?? 'request failed';
  if (failure === 'net::ERR_ABORTED') return;
  apiFailures.push({
    method: request.method(),
    url: url.toString(),
    failure,
  });
});

page.on('console', (message) => {
  if (message.type() === 'error') {
    errors.push(`browser console error: ${message.text()}`);
  }
});

let foundRuns = [];
let missingRuns = [];

try {
  await page.goto(`${CITY_BASE}/runs`, {
    waitUntil: 'domcontentloaded',
    timeout: 15_000,
  });
  await page.getByRole('heading', { name: 'Formula Runs' }).waitFor({ timeout: 10_000 });

  const runLinks = await collectRunLinks(page);
  foundRuns = EXPECTED_RUNS
    .map((expected) => ({ expected, lane: runLinks.find((lane) => laneMatches(lane, expected)) }))
    .filter((entry) => entry.lane !== undefined);
  missingRuns = EXPECTED_RUNS.filter(
    (expected) => !foundRuns.some((entry) => entry.expected === expected),
  );

  for (const { expected, lane } of foundRuns) {
    await verifyRun(page, expected, lane, errors);
  }
} finally {
  await context.close();
  await browser.close();
}

recordApiFailures(errors, apiCalls, apiFailures);

for (const missing of missingRuns) {
  errors.push(
    `missing ${missing.key} run for ${missing.scopeKind}:${missing.scopeRef} on /runs`,
  );
}

console.log(`sample formula run e2e: city ${CITY}`);
console.log(`sample formula run e2e: found ${foundRuns.length}/${EXPECTED_RUNS.length} expected runs`);
for (const { expected, lane } of foundRuns) {
  console.log(`  found ${expected.key}: ${lane.id} (${lane.title})`);
}
for (const missing of missingRuns) {
  console.log(`  missing ${missing.key}: ${missing.scopeKind}:${missing.scopeRef}`);
}

if (errors.length > 0) {
  console.error('sample formula run e2e: FAILED');
  for (const error of errors) console.error(`  ${error}`);
  exit(1);
}

console.log('sample formula run e2e: PASSED');

async function verifyRun(page, expected, lane, errors) {
  await page.goto(`${CITY_BASE}/runs`, {
    waitUntil: 'domcontentloaded',
    timeout: 15_000,
  });
  await page.getByRole('heading', { name: 'Formula Runs' }).waitFor({ timeout: 10_000 });

  const laneLink = page.getByRole('link', { name: lane.title });
  const laneLinkCount = await waitForLocatorCount(laneLink, 1, 10_000);
  if (laneLinkCount !== 1) {
    errors.push(`${expected.key}: expected one /runs link named "${lane.title}", got ${laneLinkCount}`);
    return;
  }

  await laneLink.click();
  await page.waitForURL(lane.href, { timeout: 10_000 });
  await page.locator('h1').waitFor({ timeout: 10_000 });
  await page.getByRole('heading', { name: 'Formula Graph' }).waitFor({ timeout: 10_000 });
  await page.getByRole('heading', { name: 'Local changes' }).waitFor({ timeout: 10_000 });

  const graphButtons = page.locator('section[aria-label="Formula run graph"] button');
  const graphButtonCount = await graphButtons.count();
  if (graphButtonCount === 0) {
    errors.push(`${expected.key}: graph rendered no selectable nodes`);
    return;
  }

  const selectedButton = graphButtons.first();
  await selectedButton.click();
  await expectPressedCount(page, expected.key, 1, errors);
  await selectedButton.click();
  await expectPressedCount(page, expected.key, 0, errors);

  await selectedButton.click();
  const sessionTab = page.getByRole('tab', { name: 'Session' });
  if (await sessionTab.isEnabled()) {
    await sessionTab.click();
    await page.locator('[role="tabpanel"]').waitFor({ timeout: 5_000 });
    await page.waitForTimeout(300);
  } else {
    const sessionDisabled = await sessionTab.evaluate((node) =>
      node instanceof HTMLButtonElement &&
      node.disabled &&
      node.getAttribute('aria-disabled') === 'true',
    );
    if (!sessionDisabled) {
      errors.push(`${expected.key}: Session tab was neither enabled nor explicitly disabled`);
    }
  }

  await page.getByRole('tab', { name: 'Diff' }).click();
  await page.getByRole('heading', { name: 'Local changes' }).waitFor({ timeout: 10_000 });
}

async function collectRunLinks(page) {
  await page.locator('a[href*="/runs/"]').first().waitFor({ timeout: 10_000 });
  const links = await page.locator('a[href*="/runs/"]').evaluateAll((anchors) =>
    anchors
      .map((anchor) => ({
        href: anchor instanceof HTMLAnchorElement ? anchor.href : '',
        title: anchor.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      }))
      .filter((link) => link.href.length > 0 && link.title.length > 0),
  );

  return links.flatMap((link) => {
    const url = new URL(link.href);
    const runId = url.pathname.match(/\/runs\/([^/]+)$/)?.[1];
    if (runId === undefined) return [];
    return [{
      id: decodeURIComponent(runId),
      title: link.title,
      href: url.toString(),
      scopeKind: url.searchParams.get('scope_kind'),
      scopeRef: url.searchParams.get('scope_ref'),
    }];
  });
}

async function expectPressedCount(page, label, expectedCount, errors) {
  const count = await page
    .locator('section[aria-label="Formula run graph"] button[aria-pressed="true"]')
    .count();
  if (count !== expectedCount) {
    errors.push(`${label}: selected-node count was ${count}, expected ${expectedCount}`);
  }
}

async function waitForLocatorCount(locator, expected, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastCount = 0;
  while (Date.now() <= deadline) {
    lastCount = await locator.count();
    if (lastCount === expected) return lastCount;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return lastCount;
}

function laneMatches(candidate, expected) {
  return (
    candidate?.scopeKind === expected.scopeKind &&
    candidate?.scopeRef === expected.scopeRef &&
    typeof candidate?.title === 'string' &&
    expected.title.test(candidate.title)
  );
}

async function discoverFirstCity(baseUrl) {
  const registry = await fetchJson(`${baseUrl}/gc-supervisor/v0/cities`);
  const first = registry?.items?.[0]?.name;
  if (typeof first !== 'string' || first.length === 0) {
    throw new Error('no city registered; set DASHBOARD_CITY explicitly');
  }
  return first;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`${response.status} ${response.statusText} from ${url}: ${body.slice(0, 500)}`);
  }
  return response.json();
}

function isObservedApiPath(pathname) {
  return pathname.startsWith('/api/') || pathname.startsWith('/gc-supervisor/');
}

function recordApiFailures(errors, apiCalls, apiFailures) {
  const failedApiCalls = apiCalls.filter((call) => call.status >= 400);
  for (const call of failedApiCalls) {
    errors.push(`unexpected API failure: ${call.status} ${call.method} ${call.url}`);
  }
  for (const call of apiFailures) {
    errors.push(`unexpected API request failure: ${call.method} ${call.url} (${call.failure})`);
  }
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

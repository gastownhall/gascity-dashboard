// Live user-flow regression gate for the gas-city-dashboard production node.
//
// Drives REAL operator flows against whatever is serving the dashboard at
// http://127.0.0.1:8082 (the detached production node; the backend binds
// 127.0.0.1 only — this stays on loopback and never exposes anything). It does
// NOT start its own server: it tests the working tree of whichever checkout is
// serving that port, mirroring the snap-harness contract in AGENTS.md.
//
// Two modes:
//   node scripts/dashboard-tester.mjs           # run + report, always exit 0
//   node scripts/dashboard-tester.mjs --test    # run + assert; non-zero exit on regression
//
// Base URL override (default http://127.0.0.1:8082):
//   DASHBOARD_BASE=http://127.0.0.1:5174 node scripts/dashboard-tester.mjs --test
//
// What it exercises (all against live supervisor data):
//   • Home (/)            — header + census/status body, no blank render.
//   • Agents (/agents)    — roster rows render, `rig · agent` labels, SSE live.
//   • Runs (/runs)        — lanes render, SSE live, deep-link into a run detail.
//   • Beads (/beads)      — board rows or an explicit empty/unavailable state.
//   • Mail (/mail)        — message rows or an explicit empty state.
//   • Stuck/blocked agents — surfaced (never hidden by the running-only default).
//   • Fail-safe injection — with every /api/* and /gc-supervisor/* call forced
//     to 503, each route MUST render an explicit unavailable/degraded signal
//     and never a false all-clear. This is the core regression the gate guards.
//
// Cross-cutting assertions on every healthy flow: no broken /api/* or
// /gc-supervisor/* responses (>=400) and no console/page errors. Status is
// asserted on text/glyph (the DESIGN.md Greyscale Test), never on color.
//
// SSE note: the city event stream keeps the network permanently busy, so every
// navigation uses `domcontentloaded` + explicit selector waits — never
// `networkidle`, which would hang forever.
//
// Skips (exit 0), not failures, when nothing is serving the base URL — same as
// the snap harness. A real regression is the only thing that returns non-zero.

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { argv, env, exit } from 'node:process';

const BASE = env.DASHBOARD_BASE || 'http://127.0.0.1:8082';
const OUT = '/tmp/cp-snaps';
const TEST_MODE = argv.includes('--test');
const VIEWPORT = { width: 1440, height: 900 };
const SSE_TIMEOUT_MS = 12_000;
const SETTLE_MS = 2_500;

const isDataCall = (url) => url.includes('/api/') || url.includes('/gc-supervisor/');
const short = (s, n = 110) => (s ?? '').toString().replace(/\s+/g, ' ').trim().slice(0, n);

// An explicit "data is not live" signal in the route's own content: the
// wordings the views render on a source error / empty / fixture fallback. Used
// to prove the fail-safe — a fetch failure must surface as one of these, never
// a blank healthy view. Deliberately excludes the SSE badge's "offline" chrome
// so the signal must come from the data view, not the always-degraded stream
// indicator that the same fault knocks offline.
const DEGRADED_TEXT = /(unavailable|fixture data|empty for)/i;

// ---------------------------------------------------------------------------
// Per-flow helpers — each returns/mutates a { name, errors, info } envelope.
// ---------------------------------------------------------------------------

const makeResult = (name) => ({ name, errors: [], info: {} });

async function withPage(browser, fn) {
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();
  try {
    return await fn(page);
  } finally {
    await ctx.close();
  }
}

/**
 * Attach response + console collectors to a page, then fold whatever they
 * capture into `result` when the returned drain() is called after navigation.
 */
function collectErrors(page, result) {
  const apiErrors = [];
  const consoleErrors = [];
  page.on('response', (r) => {
    if (isDataCall(r.url()) && r.status() >= 400) {
      apiErrors.push(`${r.status()} ${r.request().method()} ${short(r.url(), 90)}`);
    }
  });
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(short(m.text()));
  });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${short(e.message)}`));
  return () => {
    for (const e of apiErrors) result.errors.push(`broken data call: ${e}`);
    for (const e of consoleErrors) result.errors.push(`console error: ${e}`);
  };
}

/** Assert the page's display heading. Records it on the result either way. */
async function assertH1(page, result, expected, label) {
  // `domcontentloaded` fires before React hydrates the heading; wait for the
  // element so we read the mounted title, not a pre-hydration null.
  await page
    .locator('h1')
    .first()
    .waitFor({ timeout: 8_000 })
    .catch(() => {});
  const h1 = short(
    await page
      .locator('h1')
      .first()
      .textContent()
      .catch(() => null),
    40,
  );
  result.info.h1 = h1;
  if (h1 !== expected) {
    result.errors.push(`${label}: expected h1 "${expected}", got ${JSON.stringify(h1)}`);
  }
}

/** Assert the SSE badge reaches "live" (the word, greyscale-safe — not color). */
async function assertSseLive(page, result, label) {
  const badge = page.locator('span[title^="SSE stream"]');
  try {
    await badge
      .filter({ hasText: /live/ })
      .first()
      .waitFor({ state: 'visible', timeout: SSE_TIMEOUT_MS });
    result.info.sse = 'live';
  } catch {
    const seen = short(
      await badge
        .first()
        .textContent()
        .catch(() => null),
      40,
    );
    result.info.sse = seen;
    result.errors.push(`${label}: SSE stream never reached "live" (saw ${JSON.stringify(seen)})`);
  }
}

/**
 * Assert the view rendered real content OR an explicit empty/unavailable state
 * — never a blank false all-clear. `rowsSelector` counts populated rows;
 * `emptyRe` matches the route's own empty wording.
 */
async function assertContentOrEmpty(page, result, label, rowsSelector, emptyRe) {
  const rows = await page
    .locator(rowsSelector)
    .count()
    .catch(() => 0);
  const alerts = await page
    .locator('[role="alert"]')
    .count()
    .catch(() => 0);
  // Read the whole content area, not the first <section> — routes like Mail
  // render the list (and its empty message) in a second section.
  const bodyText = await page
    .locator('main')
    .first()
    .innerText()
    .catch(() => '');
  result.info.rows = rows;
  if (rows === 0 && alerts === 0 && !(emptyRe.test(bodyText) || DEGRADED_TEXT.test(bodyText))) {
    result.errors.push(`${label}: neither rows nor an explicit empty/unavailable state rendered`);
  }
}

async function snap(page, name) {
  try {
    await page.screenshot({ path: `${OUT}/dashboard-tester-${name}.png` });
  } catch {
    // screenshots are debug aids; never let one fail the gate
  }
}

// ---------------------------------------------------------------------------
// City discovery + reachability preflight
// ---------------------------------------------------------------------------

/**
 * Resolve the active city from the nav (links are `/city/<city>/...`). Returns
 * { cityBase } on success, { skip } when the base URL isn't reachable (exit 0,
 * snap-harness contract), or { fail } when the node IS reachable but renders no
 * city nav — a broken shell is a regression, not a legitimate skip.
 */
async function discoverCity(browser) {
  return withPage(browser, async (page) => {
    try {
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 10_000 });
    } catch (err) {
      const s = String(err);
      if (/ERR_CONNECTION_REFUSED|net::ERR|NS_ERROR|Timeout/.test(s)) {
        return { skip: `base URL not reachable at ${BASE}` };
      }
      throw err;
    }
    // The nav hydrates with React; wait for a link before reading it so a slow
    // mount isn't mistaken for a broken shell.
    await page
      .locator('nav a, header a')
      .first()
      .waitFor({ timeout: 8_000 })
      .catch(() => {});
    const href = await page
      .locator('nav a, header a')
      .first()
      .getAttribute('href')
      .catch(() => null);
    const match = href?.match(/\/city\/([^/]+)/);
    if (!match) {
      return { fail: `reachable at ${BASE} but no /city/<name> nav link rendered (broken shell?)` };
    }
    return { cityBase: `${BASE}/city/${match[1]}` };
  });
}

// ---------------------------------------------------------------------------
// Healthy flows
// ---------------------------------------------------------------------------

async function checkHome(browser, cityBase) {
  const result = makeResult('home');
  await withPage(browser, async (page) => {
    const drain = collectErrors(page, result);
    await page.goto(cityBase, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await assertH1(page, result, 'Home', 'home');
    // Home's run-summary source is heavy (listBeads limit 1000) and can take
    // several seconds, sitting in a "Loading…" state. Wait for it to settle
    // into real content or an explicit unavailable alert before asserting — a
    // bare header that never leaves Loading… would be the actual regression.
    await page
      .waitForFunction(
        () => {
          const t = document.querySelector('main')?.innerText ?? '';
          return t.length > 0 && !/Loading…/.test(t);
        },
        { timeout: 15_000 },
      )
      .catch(() => {
        result.info.loadingWaitTimedOut = true;
      });
    const bodyText = await page
      .locator('main')
      .first()
      .innerText()
      .catch(() => '');
    if (bodyText.length < 20 || /Loading…/.test(bodyText)) {
      result.errors.push('home: body never rendered content (stuck in Loading…?)');
    }
    drain();
    await snap(page, 'home');
  });
  return result;
}

async function checkAgents(browser, cityBase) {
  const result = makeResult('agents');
  await withPage(browser, async (page) => {
    const drain = collectErrors(page, result);
    await page.goto(`${cityBase}/agents`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await assertH1(page, result, 'Agents', 'agents');
    await assertSseLive(page, result, 'agents');

    await page.waitForTimeout(SETTLE_MS);
    const rosterAlert = await page
      .getByText(/agent roster unavailable/i)
      .count()
      .catch(() => 0);
    const labels = await page
      .locator('table tbody a[href*="/agents/"]')
      .allInnerTexts()
      .catch(() => []);
    if (rosterAlert > 0) {
      result.info.note = 'roster unavailable (explicit alert)';
    } else if (labels.length === 0) {
      result.errors.push('agents: roster available but zero rows rendered (possible blank render)');
    } else {
      result.info.rows = labels.length;
      // "rig column correct": a populated roster on a live city always shows at
      // least one `rig · agent` label. Its total absence means the rig-prefix
      // label construction regressed, so this is a gate, not an observation.
      const rigLabel = labels.find((l) => l.includes(' · '));
      if (rigLabel) {
        result.info.rigLabelSample = short(rigLabel, 50);
      } else {
        result.errors.push(
          'agents: roster rows render but none show the `rig · agent` label (rig column regression?)',
        );
      }
    }

    // Stuck/blocked-agent visibility: a "needs you" agent must render even
    // though the running-only filter is on by default. Data-dependent, so it's
    // an observation, not a hard gate — but if present it must be visible.
    const needsYou = page.getByText(/needs you/i);
    const needsYouCount = await needsYou.count().catch(() => 0);
    result.info.stuckOrBlocked = needsYouCount;
    if (needsYouCount > 0) {
      const visible = await needsYou
        .first()
        .isVisible()
        .catch(() => false);
      if (!visible) result.errors.push('agents: a "needs you" agent is present but not visible');
    }

    drain();
    await snap(page, 'agents');
  });
  return result;
}

async function checkRuns(browser, cityBase) {
  const result = makeResult('runs');
  await withPage(browser, async (page) => {
    const drain = collectErrors(page, result);
    await page.goto(`${cityBase}/runs`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await assertH1(page, result, 'Formula Runs', 'runs');
    await assertSseLive(page, result, 'runs');

    await page.waitForTimeout(SETTLE_MS);
    // Deep-link: if any active run lane exists, click into its detail and
    // assert the detail route mounts cleanly. No active runs is not a failure.
    const laneLinks = page.locator('a[href*="/runs/"]');
    const laneCount = await laneLinks.count().catch(() => 0);
    result.info.runLanes = laneCount;
    if (laneCount > 0) {
      await laneLinks.first().click();
      try {
        await page.waitForURL(/\/runs\/[^/]+/, { timeout: 8_000 });
        await page.locator('h1, h2, [role="heading"]').first().waitFor({ timeout: 8_000 });
        result.info.deepLink = short(page.url().replace(BASE, ''), 70);
      } catch {
        result.errors.push('runs: deep-link into a run detail did not mount a heading');
      }
    } else {
      result.info.deepLink = 'skipped (no active run lanes)';
    }

    drain();
    await snap(page, 'runs');
  });
  return result;
}

async function checkBeads(browser, cityBase) {
  const result = makeResult('beads');
  await withPage(browser, async (page) => {
    const drain = collectErrors(page, result);
    await page.goto(`${cityBase}/beads`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await page.waitForTimeout(SETTLE_MS);
    await assertH1(page, result, 'Beads', 'beads');
    await assertContentOrEmpty(page, result, 'beads', 'button[title^="Select "]', /no beads/i);
    drain();
    await snap(page, 'beads');
  });
  return result;
}

async function checkMail(browser, cityBase) {
  const result = makeResult('mail');
  await withPage(browser, async (page) => {
    const drain = collectErrors(page, result);
    await page.goto(`${cityBase}/mail`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await page.waitForTimeout(SETTLE_MS);
    await assertH1(page, result, 'Mail', 'mail');
    await assertContentOrEmpty(page, result, 'mail', 'table tbody tr', /no messages|empty for/i);
    drain();
    await snap(page, 'mail');
  });
  return result;
}

// ---------------------------------------------------------------------------
// Fail-safe injection: force every data call to 503 and assert each route
// renders an explicit unavailable/degraded signal — never a false all-clear.
// Console errors are EXPECTED here (the failed fetches log), so they are not
// asserted; only the degraded-signal contract is.
// ---------------------------------------------------------------------------

async function checkFailSafe(browser, cityBase, route, label) {
  const result = makeResult(`failsafe:${label}`);
  await withPage(browser, async (page) => {
    await page.route('**/*', (r) => {
      if (isDataCall(r.request().url())) {
        return r.fulfill({
          status: 503,
          contentType: 'application/json',
          body: '{"error":"dashboard-tester injected fault"}',
        });
      }
      return r.continue();
    });
    await page.goto(`${cityBase}${route}`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await page.waitForTimeout(SETTLE_MS + 1_500);
    const alerts = await page
      .locator('[role="alert"]')
      .count()
      .catch(() => 0);
    const bodyText = await page
      .locator('body')
      .innerText()
      .catch(() => '');
    result.info.alerts = alerts;
    if (alerts > 0 || DEGRADED_TEXT.test(bodyText)) {
      result.info.signal = alerts > 0 ? `${alerts} alert(s)` : 'degraded text';
    } else {
      result.errors.push(
        `failsafe ${label}: all data calls failed yet no explicit unavailable signal rendered — false all-clear (body: ${short(bodyText, 80)})`,
      );
    }
    await snap(page, `failsafe-${label}`);
  });
  return result;
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

const ROUTES = [
  ['', 'home'],
  ['/agents', 'agents'],
  ['/runs', 'runs'],
  ['/beads', 'beads'],
  ['/mail', 'mail'],
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const results = [];
let skipReason = null;

try {
  const discovery = await discoverCity(browser);
  if (discovery.skip) {
    skipReason = discovery.skip;
  } else if (discovery.fail) {
    results.push({ name: 'preflight', errors: [discovery.fail], info: {} });
  } else {
    const { cityBase } = discovery;
    console.log(`dashboard-tester: driving ${cityBase}`);
    // Healthy flows run sequentially — each opens its own context for clean
    // per-route error attribution and an isolated SSE lifecycle.
    results.push(await checkHome(browser, cityBase));
    results.push(await checkAgents(browser, cityBase));
    results.push(await checkRuns(browser, cityBase));
    results.push(await checkBeads(browser, cityBase));
    results.push(await checkMail(browser, cityBase));
    for (const [route, label] of ROUTES) {
      results.push(await checkFailSafe(browser, cityBase, route, label));
    }
  }
} finally {
  await browser.close();
}

// Report.
if (skipReason) {
  console.log(`dashboard-tester: SKIPPED — ${skipReason}`);
  exit(0);
}

let hadErrors = false;
for (const r of results) {
  const info = Object.entries(r.info)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(' ');
  if (r.errors.length) {
    hadErrors = true;
    console.error(`[${r.name}] FAIL${info ? ` (${info})` : ''}`);
    for (const e of r.errors) console.error(`  - ${e}`);
  } else {
    console.log(`[${r.name}] PASS${info ? ` — ${info}` : ''}`);
  }
}

if (TEST_MODE) {
  if (hadErrors) {
    console.error('dashboard-tester: FAILED');
    exit(1);
  }
  console.log('dashboard-tester: PASSED');
}

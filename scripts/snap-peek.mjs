// Snap and regression-test the Peek modal.
//
// Two modes:
//   node scripts/snap-peek.mjs           # snap-only, PNGs to /tmp/cp-snaps
//   node scripts/snap-peek.mjs --test    # snap + assert; non-zero exit on regression
//
// What it asserts in --test mode:
//   (1) Frontend dev server reachable at http://127.0.0.1:5174 — if not, SKIP (exit 0).
//   (2) /agents loads and a Peek button exists — if not, SKIP (no live sessions).
//   (3) Clicking Peek opens role="dialog" aria-modal="true".
//   (4) The modal panel renders opaque: computed background-color alpha === 1.
//       (Modal.tsx contract: panel is bg-surface, not the bg-fg/30 scrim.)
//   (5) At least one direct supervisor transcript GET returns 200, and no
//       deleted dashboard /api/.../sessions/<id>/peek mirror is called.
//
// Skips, not failures, when the backend is unreachable. Returns non-zero only on
// a real regression (modal transparent, transcript GET 4xx/5xx, modal didn't open).

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { argv, exit } from 'node:process';

const BASE = 'http://127.0.0.1:5174';
const OUT  = '/tmp/cp-snaps';
const TEST_MODE = argv.includes('--test');

await mkdir(OUT, { recursive: true });

/**
 * Parse a CSS color string and return its alpha channel (0..1).
 * Accepts rgb(), rgba(), hex (#rgb / #rrggbb / #rrggbbaa), and the modern
 * color-function syntax oklch() / oklab() / lch() / lab() / hsl() / hwb() /
 * color(). Chromium 111+ serializes getComputedStyle().backgroundColor in the
 * declared color space, so on this codebase bg-surface comes back as oklch(...).
 *
 * Returns 1 for any opaque format, the literal alpha when an "/ <alpha>" tail
 * is present. Returns null if the string can't be parsed at all (treat as
 * unknown, NOT opaque — caller should surface the unparsed string).
 */
function parseAlpha(color) {
  if (!color) return null;
  const s = String(color).trim().toLowerCase();
  // hex first (no parens)
  if (s.startsWith('#')) {
    if (s.length === 9) return parseInt(s.slice(7, 9), 16) / 255; // #rrggbbaa
    if (s.length === 5) return parseInt(s.slice(4, 5).repeat(2), 16) / 255; // #rgba
    return 1; // opaque hex
  }
  // Any function-form color: rgb / rgba / hsl / hsla / hwb / lab / lch /
  // oklab / oklch / color. The contract for all of them is the same:
  // an explicit "/ <alpha>" tail means non-opaque, otherwise opaque.
  const fnMatch = s.match(/^([a-z]+)\((.*)\)$/);
  if (fnMatch) {
    const args = fnMatch[2];
    const alphaMatch = args.match(/\/\s*([\d.]+%?)\s*$/);
    if (alphaMatch) {
      const raw = alphaMatch[1];
      return raw.endsWith('%') ? Number(raw.slice(0, -1)) / 100 : Number(raw);
    }
    // Comma syntax for rgba/hsla: rgba(r, g, b, a)
    const commaAlpha = args.match(/,\s*([\d.]+%?)\s*$/);
    if (commaAlpha && /^(rgba|hsla)$/.test(fnMatch[1]) && args.split(',').length === 4) {
      const raw = commaAlpha[1];
      return raw.endsWith('%') ? Number(raw.slice(0, -1)) / 100 : Number(raw);
    }
    return 1; // function-form with no alpha tail is opaque
  }
  return null;
}

/**
 * One pass over a theme. Returns a result envelope:
 *   { theme, skipped: 'no-frontend' | 'no-sessions' | null, errors: string[], info: {...} }
 *
 * 'no-frontend' fires when the Vite dev server at :5174 is not reachable.
 * The backend can be independently up or down; that surfaces as failed peek
 * calls inside a normal run, not as a skip.
 */
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
  const page = await ctx.newPage();
  const apiCalls = [];
  page.on('response', (r) => {
    if (r.url().includes('/api/') || r.url().includes('/gc-supervisor/')) {
      apiCalls.push({ url: r.url(), method: r.request().method(), status: r.status() });
    }
  });

  try {
    try {
      await page.goto(`${BASE}/agents`, { waitUntil: 'domcontentloaded', timeout: 5_000 });
    } catch (err) {
      if (String(err).includes('ERR_CONNECTION_REFUSED') || String(err).includes('net::ERR') || String(err).includes('NS_ERROR')) {
        result.skipped = 'no-frontend';
        return result;
      }
      throw err;
    }
    await page.waitForSelector('header', { timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(1500);

    const peekBtn = page.getByRole('button', { name: /^peek/i }).first();
    if ((await peekBtn.count()) === 0) {
      result.skipped = 'no-sessions';
      const snapPath = `${OUT}/${theme}-agents-peek.png`;
      await page.screenshot({ path: snapPath });
      result.info.snap = snapPath;
      return result;
    }

    await peekBtn.click();

    // Wait for the modal to appear, then for the peek response to settle.
    const dialog = page.locator('div[role="dialog"][aria-modal="true"]');
    let modalOpened = false;
    try {
      await dialog.waitFor({ state: 'visible', timeout: 3_000 });
      modalOpened = true;
    } catch {
      result.errors.push('modal did not appear after clicking Peek');
    }

    // Only run the downstream assertions if the modal actually opened. When it
    // doesn't, the panel and network assertions are guaranteed to fail too and
    // would just duplicate the root-cause error.
    if (modalOpened) {
      // Give the POST /peek a chance to round-trip.
      await page.waitForTimeout(1500);

      // Read computed background-color on the inner panel (first child of dialog).
      // The outer dialog div is the scrim (bg-fg/30); the inner div is bg-surface.
      const panelBg = await dialog.evaluate((node) => {
        const inner = node.firstElementChild;
        if (!(inner instanceof HTMLElement)) return null;
        return getComputedStyle(inner).backgroundColor;
      });
      result.info.panelBg = panelBg;
      const alpha = parseAlpha(panelBg);
      result.info.panelAlpha = alpha;
      if (alpha === null) {
        result.errors.push(`could not parse modal panel background-color: ${panelBg}`);
      } else if (alpha < 0.99) {
        result.errors.push(`modal panel not opaque: alpha=${alpha} (background=${panelBg})`);
      }

      // Assertion: at least one direct supervisor transcript GET returned 200.
      const transcriptCalls = apiCalls.filter(
        (c) => c.method === 'GET' &&
          /\/gc-supervisor\/v0\/city\/[^/]+\/session\/[^/]+\/transcript(?:\?|$)/.test(c.url),
      );
      const deletedPeekCalls = apiCalls.filter(
        (c) => /\/api\/city\/[^/]+\/sessions\/[^/]+\/peek$/.test(c.url),
      );
      result.info.transcriptCalls = transcriptCalls;
      result.info.deletedPeekCalls = deletedPeekCalls;
      if (deletedPeekCalls.length > 0) {
        const summary = deletedPeekCalls.map((c) => `${c.method} ${c.status} ${c.url}`).join('; ');
        result.errors.push(`deleted dashboard peek mirror was called: ${summary}`);
      } else if (transcriptCalls.length === 0) {
        result.errors.push('no GET /gc-supervisor/v0/city/<city>/session/<id>/transcript was observed');
      } else if (!transcriptCalls.some((c) => c.status === 200)) {
        const summary = transcriptCalls.map((c) => `${c.status} ${c.url}`).join('; ');
        result.errors.push(`no successful (200) supervisor transcript response. Saw: ${summary}`);
      }
    }

    const snapPath = `${OUT}/${theme}-agents-peek.png`;
    await page.screenshot({ path: snapPath });
    result.info.snap = snapPath;
    result.info.apiCalls4xx = apiCalls.filter((c) => c.status >= 400);
  } finally {
    await ctx.close();
  }

  return result;
}

const browser = await chromium.launch();
const results = [];
try {
  for (const theme of ['light', 'dark']) {
    results.push(await runTheme(browser, theme));
  }
} finally {
  await browser.close();
}

// Report.
let hadErrors = false;
for (const r of results) {
  if (r.skipped === 'no-frontend') {
    console.log(`[${r.theme}] SKIP, frontend not reachable at ${BASE}`);
    continue;
  }
  if (r.skipped === 'no-sessions') {
    console.log(`[${r.theme}] SKIP — no Peek button found (no active sessions)`);
    if (r.info.snap) console.log(`[${r.theme}] snap ${r.info.snap}`);
    continue;
  }
  if (r.info.snap) console.log(`[${r.theme}] snap ${r.info.snap}`);
  if (r.info.panelBg !== undefined) {
    console.log(`[${r.theme}] panel bg=${r.info.panelBg} alpha=${r.info.panelAlpha}`);
  }
  if (r.info.transcriptCalls?.length) {
    for (const c of r.info.transcriptCalls) console.log(`[${r.theme}] transcript: ${c.status} ${c.url}`);
  }
  if (r.info.deletedPeekCalls?.length) {
    for (const c of r.info.deletedPeekCalls) console.log(`[${r.theme}] deleted peek mirror: ${c.status} ${c.url}`);
  }
  if (r.info.apiCalls4xx?.length) {
    console.log(`[${r.theme}] 4xx/5xx API calls:`, r.info.apiCalls4xx);
  }
  if (r.errors.length) {
    hadErrors = true;
    for (const e of r.errors) console.error(`[${r.theme}] FAIL — ${e}`);
  } else if (TEST_MODE) {
    console.log(`[${r.theme}] PASS`);
  }
}

if (TEST_MODE) {
  if (hadErrors) {
    console.error('peek regression: FAILED');
    exit(1);
  }
  const ranAny = results.some((r) => r.skipped === null);
  if (!ranAny) {
    const reason = results.every((r) => r.skipped === 'no-frontend')
      ? 'no live frontend'
      : 'no active sessions to peek';
    console.log(`peek regression: SKIPPED (${reason})`);
    exit(0);
  }
  console.log('peek regression: PASSED');
}

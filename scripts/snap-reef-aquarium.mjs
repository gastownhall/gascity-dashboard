// Playwright snapshot + perf harness for the Canvas-2D /reef aquarium route.
// Feeds screenshots, a fixture manifest, unlabeled pose crops, and a camera
// perf sweep into the vision-judge loop described in specs/plans/reef-aquarium.md.
//
// Usage:
//   node scripts/snap-reef-aquarium.mjs
//   node scripts/snap-reef-aquarium.mjs --test
//   node scripts/snap-reef-aquarium.mjs --test --live-ux
//   node scripts/snap-reef-aquarium.mjs --skip-perf
//   node scripts/snap-reef-aquarium.mjs --out=/tmp/round-3
//
// Env:
//   SNAP_BASE  dev server base URL   (default http://127.0.0.1:5174)
//   SNAP_CITY  city slug             (default racoon-city)
//
// Does NOT start a server — it drives whatever Vite is already serving at
// SNAP_BASE, same convention as scripts/snap.mjs and
// scripts/snap-formula-run-detail.mjs.
//
// Output (under --out, default /tmp/reef-aquarium-snaps/<timestamp>/):
//   <theme>-lod0.png, <theme>-lod1.png, <theme>-lod2.png   per theme (light, dark)
//   manifest.json               window.__aquariumManifest (identical across themes)
//   flow.png / flow.json        deterministic recent rig movement proof
//   blind-<i>.png               unlabeled fish crops (light theme only)
//   blind-key.json              answer key for the blind crops (index -> pose)
//   perf.json                   frame-time stats from the scripted camera workout
//
// Final stdout line: a single JSON summary — {out, shots, perf, errors} — for
// an orchestrating agent to parse.

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { argv, env, exit } from 'node:process';

// Contract constants mirrored from frontend/src/aquarium/contracts.ts. Kept
// as literals here (this harness is plain ESM, not compiled TS) — re-check
// against contracts.ts if the fixture URL contract changes.
const FIXTURE_QUERY_PARAM = 'fixture';
const CAMERA_HASH_PREFIX = '#cam=';
const LOD1_ZOOM = 0.9;
const LOD2_ZOOM = 2.2;

const BASE = env.SNAP_BASE || 'http://127.0.0.1:5174';
const CITY = env.SNAP_CITY || 'racoon-city';
const CITY_BASE = `${BASE}/city/${encodeURIComponent(CITY)}`;

const args = argv.slice(2);
const TEST_MODE = args.includes('--test');
const LIVE_UX_MODE = args.includes('--live-ux');
const SKIP_PERF = args.includes('--skip-perf');
const outArg = args.find((a) => a.startsWith('--out='));
const OUT = outArg ? outArg.slice('--out='.length) : `/tmp/reef-aquarium-snaps/${timestamp()}`;

const THEMES = ['light', 'dark'];

// Fixed probe coords for LOD1/LOD2: a deterministic seabed-left region at
// zoom >= the respective LOD threshold. The fixture is deterministic so this
// is reproducible; if the region turns out to be empty water the honesty
// judges will say so and these get tuned in the next round.
const LOD1_CAM = { x: 1000, y: 1700, zoom: 1.0 };
const LOD2_CAM = { x: 1000, y: 1700, zoom: 2.4 };

// Enforce the invariant the comment above used to just assert in prose: if
// contracts.ts ever moves the LOD thresholds, these fixed probe zooms must
// move with them or LOD1/LOD2 shots silently stop exercising the fade-in
// they're meant to capture.
if (LOD1_CAM.zoom < LOD1_ZOOM) {
  throw new Error(`LOD1_CAM.zoom (${LOD1_CAM.zoom}) must be >= LOD1_ZOOM (${LOD1_ZOOM})`);
}
if (LOD2_CAM.zoom < LOD2_ZOOM) {
  throw new Error(`LOD2_CAM.zoom (${LOD2_CAM.zoom}) must be >= LOD2_ZOOM (${LOD2_ZOOM})`);
}

const VIEWPORT = { width: 1440, height: 900 };
const RESPONSIVE_VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
];
const PERF_WARMUP_SAMPLES = 60;
const PERF_MIN_SAMPLES = 300;
const PERF_P95_THRESHOLD_MS = 16.0;

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function camParam(cam) {
  return `${cam.x.toFixed(2)},${cam.y.toFixed(2)},${cam.zoom.toFixed(2)}`;
}

function fixtureUrl(kind, cam) {
  const hash = cam ? `${CAMERA_HASH_PREFIX}${camParam(cam)}` : '';
  return `${CITY_BASE}/reef?${FIXTURE_QUERY_PARAM}=${kind}${hash}`;
}

function isObservedApiPath(pathname) {
  return pathname.startsWith('/api/') || pathname.startsWith('/gc-supervisor/');
}

// The aquarium fixture itself is fully client-rendered, and its hook test
// enforces zero supervisor calls. The surrounding dashboard shell still reads
// shared live data, so this browser watcher reports failures without treating
// successful shell traffic as an aquarium regression.
function attachWatchers(page, bucket) {
  const onConsole = (msg) => {
    if (msg.type() === 'error') bucket.push(`console error: ${msg.text()}`);
  };
  const onPageError = (err) => {
    bucket.push(`page error: ${err.message}`);
  };
  const onResponse = (response) => {
    const url = new URL(response.url());
    if (isObservedApiPath(url.pathname) && response.status() >= 400) {
      bucket.push(
        `failed fixture-shell response: ${response.request().method()} ${url} -> ${response.status()}`,
      );
    }
  };
  const onRequestFailed = (request) => {
    const url = new URL(request.url());
    const failure = request.failure()?.errorText ?? 'request failed';
    if (failure === 'net::ERR_ABORTED') return;
    if (isObservedApiPath(url.pathname)) {
      bucket.push(`failed fixture-shell request: ${request.method()} ${url} (${failure})`);
    }
  };
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('response', onResponse);
  page.on('requestfailed', onRequestFailed);
  return () => {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
    page.off('response', onResponse);
    page.off('requestfailed', onRequestFailed);
  };
}

async function waitForManifest(page, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const manifest = await page.evaluate(() => window.__aquariumManifest ?? null);
    if (manifest) return manifest;
    await page.waitForTimeout(150);
  }
  return null;
}

async function waitForRecentRigMovement(page, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const flow = await page.evaluate(() => window.__aquariumFlow ?? null);
    if (flow?.recentlyMovingRigKeys?.length > 0) return flow;
    await page.waitForTimeout(150);
  }
  return null;
}

async function newThemeContext(browser, theme, viewport = VIEWPORT) {
  return browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    colorScheme: theme,
    // Pre-pin the theme in localStorage, same mechanism as scripts/snap.mjs,
    // so the inline FOUC script applies data-theme before first paint.
    storageState: {
      cookies: [],
      origins: [{ origin: BASE, localStorage: [{ name: 'gascity:theme', value: theme }] }],
    },
  });
}

function attachLiveWatchers(page, bucket) {
  const onConsole = (msg) => {
    if (msg.type() === 'error') bucket.push(`console error: ${msg.text()}`);
  };
  const onPageError = (err) => bucket.push(`page error: ${err.message}`);
  const onResponse = (response) => {
    if (response.status() >= 400) {
      bucket.push(
        `failed response: ${response.request().method()} ${response.url()} -> ${response.status()}`,
      );
    }
  };
  const onRequestFailed = (request) => {
    const failure = request.failure()?.errorText ?? 'request failed';
    if (failure !== 'net::ERR_ABORTED') {
      bucket.push(`failed request: ${request.method()} ${request.url()} (${failure})`);
    }
  };
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('response', onResponse);
  page.on('requestfailed', onRequestFailed);
  return () => {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
    page.off('response', onResponse);
    page.off('requestfailed', onRequestFailed);
  };
}

async function responsiveLedgerGeometry(page) {
  return page.evaluate(() => {
    const facts = document.querySelector('[data-aquarium-ledger-facts]');
    if (!(facts instanceof HTMLElement)) return { missing: 'ledger facts' };
    const rects = Array.from(facts.children)
      .filter((node) => node instanceof HTMLElement)
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          text: node.textContent?.trim() ?? '',
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        };
      })
      .filter((rect) => rect.right > rect.left && rect.bottom > rect.top);
    const intersections = [];
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        const a = rects[i];
        const b = rects[j];
        if (
          Math.max(a.left, b.left) < Math.min(a.right, b.right) &&
          Math.max(a.top, b.top) < Math.min(a.bottom, b.bottom)
        ) {
          intersections.push([a.text, b.text]);
        }
      }
    }
    return {
      intersections,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      rects,
    };
  });
}

async function responsiveChromeGeometry(page) {
  return page.evaluate(() => {
    const legend = document.querySelector('[data-aquarium-legend]');
    const zoom = document.querySelector('[data-aquarium-zoom]');
    if (!(legend instanceof HTMLElement)) return { missing: 'map key' };
    if (!(zoom instanceof HTMLElement)) return { missing: 'zoom controls' };
    const legendRect = legend.getBoundingClientRect();
    const zoomRect = zoom.getBoundingClientRect();
    return {
      legend: {
        left: legendRect.left,
        top: legendRect.top,
        right: legendRect.right,
        bottom: legendRect.bottom,
      },
      zoom: {
        left: zoomRect.left,
        top: zoomRect.top,
        right: zoomRect.right,
        bottom: zoomRect.bottom,
      },
      overlaps:
        Math.max(legendRect.left, zoomRect.left) < Math.min(legendRect.right, zoomRect.right) &&
        Math.max(legendRect.top, zoomRect.top) < Math.min(legendRect.bottom, zoomRect.bottom),
    };
  });
}

async function assertSingleLedgerPanel(page, button, label, bucket) {
  await button.click();
  const panels = page.locator('[data-aquarium-ledger] [role="region"]');
  const count = await panels.count();
  if (count !== 1) bucket.push(`${label}: expected one shared ledger panel, received ${count}`);
  if (count === 1) {
    const box = await panels.first().boundingBox();
    const viewport = page.viewportSize();
    if (box === null || viewport === null)
      bucket.push(`${label}: detail panel had no measurable box`);
    else if (box.x < 0 || box.x + box.width > viewport.width) {
      bucket.push(`${label}: detail panel overflows horizontally (${JSON.stringify(box)})`);
    }
  }
  await button.click();
}

async function assertVisibleFishKeyboardFocus(page, bucket) {
  const firstFishLink = page.locator('nav[aria-label="fish"] a').first();
  if ((await firstFishLink.count()) !== 1) {
    bucket.push('missing semantic fish link');
    return null;
  }
  await firstFishLink.focus();
  const box = await firstFishLink.boundingBox();
  const viewport = page.viewportSize();
  if (box === null || viewport === null) {
    bucket.push('focused fish link had no measurable box');
    return box;
  }
  if (
    box.width <= 0 ||
    box.height <= 0 ||
    box.x < 0 ||
    box.y < 0 ||
    box.x + box.width > viewport.width ||
    box.y + box.height > viewport.height
  ) {
    bucket.push(`focused fish link is not fully visible (${JSON.stringify(box)})`);
  }
  return box;
}

async function captureResponsiveLiveUx(browser, errors, shots) {
  const diagnostics = [];
  for (const viewport of RESPONSIVE_VIEWPORTS) {
    const bucket = [];
    const ctx = await newThemeContext(browser, 'light', viewport);
    const page = await ctx.newPage();
    const detach = attachLiveWatchers(page, bucket);
    try {
      await page.goto(fixtureUrl('layout', null), {
        waitUntil: 'domcontentloaded',
        timeout: 15_000,
      });
      await page.waitForSelector('canvas', { timeout: 10_000 });
      await page.waitForSelector('[data-aquarium-ledger-facts]', { timeout: 10_000 });
      await page.waitForTimeout(1_000);

      const ledgerFacts = page.locator('[data-aquarium-ledger-facts]');
      const attention = ledgerFacts.getByRole('button', { name: /^\d+ need attention$/i });
      const stranded = ledgerFacts.getByRole('button', { name: /^⊘ \d+ stranded$/i });
      const coverage = ledgerFacts.getByRole('button', {
        name: 'Explain partial bead coverage',
      });
      for (const [label, locator] of [
        ['attention', attention],
        ['stranded', stranded],
        ['partial coverage', coverage],
      ]) {
        if ((await locator.count()) !== 1) bucket.push(`missing required ${label} control`);
      }

      const geometry = await responsiveLedgerGeometry(page);
      if ('missing' in geometry) bucket.push(`missing ${geometry.missing}`);
      else {
        if (geometry.intersections.length > 0) {
          bucket.push(`ledger facts overlap: ${JSON.stringify(geometry.intersections)}`);
        }
        if (geometry.scrollWidth > geometry.innerWidth) {
          bucket.push(`horizontal overflow: ${geometry.scrollWidth}px > ${geometry.innerWidth}px`);
        }
      }

      const chromeGeometry = await responsiveChromeGeometry(page);
      if ('missing' in chromeGeometry) bucket.push(`missing ${chromeGeometry.missing}`);
      else if (chromeGeometry.overlaps) {
        bucket.push(`map key overlaps zoom controls: ${JSON.stringify(chromeGeometry)}`);
      }

      if ((await attention.count()) === 1)
        await assertSingleLedgerPanel(page, attention, 'attention', bucket);
      if ((await stranded.count()) === 1)
        await assertSingleLedgerPanel(page, stranded, 'stranded', bucket);
      if ((await coverage.count()) === 1)
        await assertSingleLedgerPanel(page, coverage, 'partial coverage', bucket);

      const focusedFishLink = await assertVisibleFishKeyboardFocus(page, bucket);
      diagnostics.push({ viewport, geometry, chromeGeometry, focusedFishLink });

      const path = `${OUT}/responsive-${viewport.width}x${viewport.height}.png`;
      await page.screenshot({ path });
      shots.push(path);
    } catch (err) {
      bucket.push(err instanceof Error ? err.message : String(err));
    } finally {
      detach();
      await page.close().catch(() => {});
      await ctx.close().catch(() => {});
    }
    for (const entry of bucket)
      errors.push(`[responsive ${viewport.width}x${viewport.height}] ${entry}`);
  }
  await writeFile(`${OUT}/responsive-layout.json`, JSON.stringify(diagnostics, null, 2));
}

async function captureLod(ctx, theme, lodLabel, cam, errors, shots) {
  const page = await ctx.newPage();
  const bucket = [];
  const detach = attachWatchers(page, bucket);
  let manifest = null;
  try {
    const url = fixtureUrl('aquarium', cam);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await page.waitForSelector('canvas', { timeout: 10_000 });
    manifest = await waitForManifest(page, 10_000);
    if (!manifest) bucket.push(`missing window.__aquariumManifest after 10s`);
    await page.waitForTimeout(1200);
    const path = `${OUT}/${theme}-${lodLabel}.png`;
    await page.screenshot({ path });
    shots.push(path);
  } catch (err) {
    bucket.push(err instanceof Error ? err.message : String(err));
  } finally {
    detach();
    await page.close().catch(() => {});
  }
  for (const e of bucket) errors.push(`[${theme}/${lodLabel}] ${e}`);
  return manifest;
}

async function captureBlindCrops(browser, errors, shots) {
  const theme = 'light';
  const ctx = await newThemeContext(browser, theme);
  const bucket = [];
  let manifest = null;
  try {
    // Read the manifest (and thus blindCams) from a first page.
    const probe = await ctx.newPage();
    const detachProbe = attachWatchers(probe, bucket);
    try {
      await probe.goto(fixtureUrl('blind', null), {
        waitUntil: 'domcontentloaded',
        timeout: 15_000,
      });
      await probe.waitForSelector('canvas', { timeout: 10_000 });
      manifest = await waitForManifest(probe, 10_000);
    } finally {
      detachProbe();
      await probe.close().catch(() => {});
    }
    if (!manifest) {
      bucket.push('missing window.__aquariumManifest for blind fixture');
    } else {
      const blindCams = manifest.blindCams ?? [];
      if (blindCams.length === 0) bucket.push('manifest.blindCams was empty for the blind fixture');
      // A fresh page per crop: the camera parses '#cam' once on mount, and a
      // browser does NOT reload on a hash-only URL change, so reusing one page
      // would leave every crop at the first framing. One mount per cam is the
      // only way each '#cam' deep-link actually takes effect.
      for (let i = 0; i < blindCams.length; i += 1) {
        const page = await ctx.newPage();
        const detach = attachWatchers(page, bucket);
        try {
          await page.goto(fixtureUrl('blind', blindCams[i]), {
            waitUntil: 'domcontentloaded',
            timeout: 15_000,
          });
          await page.waitForSelector('canvas', { timeout: 10_000 });
          await page.waitForTimeout(800);
          const path = `${OUT}/blind-${i}.png`;
          await page.screenshot({ path });
          shots.push(path);
        } catch (err) {
          bucket.push(`blind-${i}: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
          detach();
          await page.close().catch(() => {});
        }
      }
    }
  } finally {
    await ctx.close().catch(() => {});
  }
  for (const e of bucket) errors.push(`[blind] ${e}`);
  if (manifest) {
    const key = manifest.fish.map((fish, i) => ({
      index: i,
      name: fish.name,
      pose: fish.pose,
      poseWord: fish.poseWord,
    }));
    await writeFile(`${OUT}/blind-key.json`, JSON.stringify(key, null, 2));
  }
  return manifest;
}

async function captureRecentRigMovement(browser, errors, shots) {
  const ctx = await newThemeContext(browser, 'light');
  const page = await ctx.newPage();
  const bucket = [];
  const detach = attachWatchers(page, bucket);
  try {
    await page.goto(fixtureUrl('flow', null), {
      waitUntil: 'domcontentloaded',
      timeout: 15_000,
    });
    await page.waitForSelector('canvas', { timeout: 10_000 });
    const manifest = await waitForManifest(page, 10_000);
    const flow = await waitForRecentRigMovement(page, 10_000);
    if (!manifest) bucket.push('missing window.__aquariumManifest for flow fixture');
    if (!flow) {
      bucket.push('missing window.__aquariumFlow recent movement for flow fixture');
    } else if (manifest) {
      const actual = flow.recentlyMovingRigKeys;
      const expected = manifest.recentlyMovingRigKeys ?? [];
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        bucket.push(
          `recent movement mismatch: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
        );
      }
      await writeFile(`${OUT}/flow.json`, JSON.stringify(flow, null, 2));
    }
    await page.waitForTimeout(1_200);
    const path = `${OUT}/flow.png`;
    await page.screenshot({ path });
    shots.push(path);
  } catch (err) {
    bucket.push(err instanceof Error ? err.message : String(err));
  } finally {
    detach();
    await page.close().catch(() => {});
    await ctx.close().catch(() => {});
  }
  for (const e of bucket) errors.push(`[flow] ${e}`);
}

// ~12s of real input events: 3 drag-pan sweeps, then wheel zoom in/out at
// varying cursor positions (6 steps in, 6 out, repeated across positions),
// net zoom change ~0 by construction (equal in/out steps each pass), ending
// on an explicit Home-key reset (the world model's documented reset control)
// so the sweep both exercises and ends on a canonical camera state.
// Budget: 100ms settle + 3 * ~1470ms pan sweeps + 2 * 3 * ~1200ms zoom
// passes + 300ms post-reset settle =~ 12s.
async function driveCameraWorkout(page) {
  const centerX = VIEWPORT.width / 2;
  const centerY = VIEWPORT.height / 2;

  await page.mouse.move(centerX, centerY);
  await page.waitForTimeout(100);

  for (let sweep = 0; sweep < 3; sweep += 1) {
    const startX = 300 + sweep * 100;
    const startY = 400 + (sweep % 2) * 150;
    const endX = VIEWPORT.width - 300 - sweep * 100;
    const endY = 500 + (sweep % 2) * 100;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.waitForTimeout(60);
    const steps = 28;
    for (let i = 1; i <= steps; i += 1) {
      await page.mouse.move(
        startX + ((endX - startX) * i) / steps,
        startY + ((endY - startY) * i) / steps,
      );
      await page.waitForTimeout(45);
    }
    await page.mouse.up();
    await page.waitForTimeout(150);
  }

  const zoomPositions = [
    { x: centerX, y: centerY },
    { x: centerX - 300, y: centerY - 150 },
    { x: centerX + 300, y: centerY + 150 },
  ];
  for (let round = 0; round < 2; round += 1) {
    for (const pos of zoomPositions) {
      await page.mouse.move(pos.x, pos.y);
      for (let step = 0; step < 6; step += 1) {
        await page.mouse.wheel(0, -100); // zoom in
        await page.waitForTimeout(100);
      }
      for (let step = 0; step < 6; step += 1) {
        await page.mouse.wheel(0, 100); // zoom out
        await page.waitForTimeout(100);
      }
    }
  }

  // End at reset: return to the canonical camera state via the same
  // keyboard control an operator would use, rather than relying on the
  // in/out wheel counts happening to net out exactly.
  await page.keyboard.press('Home');
  await page.waitForTimeout(300);
}

function computePerfStats(rawSamples) {
  const samples = rawSamples.slice(PERF_WARMUP_SAMPLES);
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (p) => {
    if (sorted.length === 0) return 0;
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[idx];
  };
  const avgMs = sorted.length > 0 ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0;
  return {
    samples: sorted.length,
    p50: percentile(50),
    p95: percentile(95),
    p99: percentile(99),
    max: sorted.length > 0 ? sorted[sorted.length - 1] : 0,
    avgFps: avgMs > 0 ? 1000 / avgMs : 0,
  };
}

async function runPerfSweep(browser, errors) {
  const theme = 'light';
  const ctx = await newThemeContext(browser, theme);
  const bucket = [];
  let result = null;
  try {
    const page = await ctx.newPage();
    const detach = attachWatchers(page, bucket);
    try {
      await page.goto(fixtureUrl('perf', null), { waitUntil: 'domcontentloaded', timeout: 15_000 });
      await page.waitForSelector('canvas', { timeout: 10_000 });
      const manifest = await waitForManifest(page, 10_000);
      if (!manifest) bucket.push('missing window.__aquariumManifest for perf fixture');
      await page.waitForTimeout(2_000);

      await driveCameraWorkout(page);

      const samples = await page.evaluate(() => window.__aquariumFrameTimesMs ?? null);
      if (!samples) {
        bucket.push('window.__aquariumFrameTimesMs was not populated after the camera workout');
      } else {
        result = computePerfStats(samples);
        if (TEST_MODE) {
          if (result.samples < PERF_MIN_SAMPLES) {
            bucket.push(
              `perf: only ${result.samples} frame samples after warmup exclusion (need >= ${PERF_MIN_SAMPLES})`,
            );
          }
          if (result.p95 >= PERF_P95_THRESHOLD_MS) {
            bucket.push(
              `perf: p95 ${result.p95.toFixed(2)}ms >= ${PERF_P95_THRESHOLD_MS}ms threshold`,
            );
          }
        }
      }
    } catch (err) {
      bucket.push(err instanceof Error ? err.message : String(err));
    } finally {
      detach();
      await page.close().catch(() => {});
    }
  } finally {
    await ctx.close().catch(() => {});
  }
  for (const e of bucket) errors.push(`[perf] ${e}`);
  if (result) await writeFile(`${OUT}/perf.json`, JSON.stringify(result, null, 2));
  return result;
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const errors = [];
  const shots = [];
  let perf = null;

  const browser = await chromium.launch({ headless: true });
  try {
    if (LIVE_UX_MODE) {
      await captureResponsiveLiveUx(browser, errors, shots);
      console.log('[responsive] live UX matrix captured');
    } else
      for (const theme of THEMES) {
        const ctx = await newThemeContext(browser, theme);
        try {
          const m0 = await captureLod(ctx, theme, 'lod0', null, errors, shots);
          const m1 = await captureLod(ctx, theme, 'lod1', LOD1_CAM, errors, shots);
          const m2 = await captureLod(ctx, theme, 'lod2', LOD2_CAM, errors, shots);
          const manifest = m0 ?? m1 ?? m2;
          if (manifest) {
            await writeFile(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2));
          } else {
            errors.push(`[${theme}] window.__aquariumManifest was never captured for any LOD`);
          }
          console.log(`[${theme}] lod0/lod1/lod2 captured`);
        } finally {
          await ctx.close().catch(() => {});
        }
      }

    if (!LIVE_UX_MODE) {
      await captureRecentRigMovement(browser, errors, shots);
      console.log('[flow] recent rig movement captured');

      await captureBlindCrops(browser, errors, shots);
      console.log('[blind] crops captured');

      if (!SKIP_PERF) {
        perf = await runPerfSweep(browser, errors);
        console.log('[perf] camera workout captured');
      }
    }
  } finally {
    await browser.close();
  }

  if (TEST_MODE) {
    if (errors.length > 0) {
      console.error('reef-aquarium snapshot: FAILED');
      console.error('');
      console.error('failures:');
      for (const e of errors) console.error(`  - ${e}`);
    } else {
      console.log('reef-aquarium snapshot: PASSED');
    }
  } else if (errors.length > 0) {
    console.warn('reef-aquarium snapshot: completed with warnings');
    for (const e of errors) console.warn(`  - ${e}`);
  }

  console.log(JSON.stringify({ out: OUT, shots, perf, errors }));

  if (TEST_MODE && errors.length > 0) exit(1);
}

main().catch((err) => {
  console.error(
    `reef-aquarium snapshot: FAILED, ${err instanceof Error ? err.message : String(err)}`,
  );
  exit(1);
});

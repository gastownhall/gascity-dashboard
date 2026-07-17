// Refuse to start when the `node` this unit will run is older than the repo's
// engines floor.
//
// The unit runs `/usr/bin/env node …`, i.e. the FIRST `node` on the unit's
// Environment=PATH. CI and package.json (`engines.node`) declare the floor, but
// `npm install` only WARNS on an older runtime — nothing stops an older node,
// first on PATH, from building and then running in production. This guard is the
// fail-fast: it asks that SAME `node` for its version (resolved off PATH exactly
// as ExecStart resolves it, not the interpreter that happens to run this guard)
// and refuses the start when it is below the floor, naming both versions and the
// unit line to fix.
//
// The floor comes from package.json `engines.node`, so the version lives in one
// place. Verified BOTH directions (a fake older node refuses, a new one passes)
// on real transient units in backend/test/deploy-unit.test.ts.
//
// Everything here FAILS CLOSED. A deploy guard that cannot read what it is
// enforcing must refuse the start, not wave it through: a guess that
// under-enforces is indistinguishable from no guard at the moment it matters.

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

/**
 * The ONLY floor syntax this guard claims to understand. Anything else — `<24`,
 * `^24.1.0`, `24.x`, `>=24`, `banana24` — is refused rather than approximated.
 * An earlier cut matched /(\d+)/ anywhere in the string, which read `<24` and
 * `banana24` alike as "floor 24": it enforced a range nobody declared.
 */
const SUPPORTED_FLOOR = /^>=\s*(\d+)\.(\d+)\.(\d+)$/;

/** `node --version` prints exactly `vX.Y.Z`. Trailing anything is not a version. */
const NODE_VERSION = /^v(\d+)\.(\d+)\.(\d+)$/;

/** @param {string} msg */
function fail(msg) {
  console.error(`gas-city-dashboard: ${msg}`);
  process.exit(1);
}

/**
 * Order two [major, minor, patch] tuples. Compared in FULL: a major-only check
 * passes 24.0.0 against a declared >=24.2.0 floor, enforcing a floor other than
 * the one package.json states.
 *
 * @param {readonly number[]} a
 * @param {readonly number[]} b
 * @returns {number} negative when `a` is older than `b`
 */
function compareVersions(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

// Wrapped in a function so each fail() is followed by a real `return`: at module
// top level `return` is a syntax error, which would leave correctness resting on
// process.exit() halting fall-through.
function main() {
  // --- the required floor, read from package.json engines.node ---
  let engines;
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    engines = pkg?.engines?.node;
  } catch (err) {
    fail(
      `cannot read package.json to determine the required Node version — ${/** @type {Error} */ (err).message}`,
    );
    return;
  }

  const floorMatch = typeof engines === 'string' ? SUPPORTED_FLOOR.exec(engines.trim()) : null;
  if (!floorMatch) {
    fail(
      `package.json engines.node is ${JSON.stringify(engines)}, which this guard cannot enforce — ` +
        `it understands only a ">=X.Y.Z" floor. State the floor in that form, or teach this guard the ` +
        `syntax; it refuses the start rather than guess at a range it cannot read.`,
    );
    return;
  }
  const floor = [Number(floorMatch[1]), Number(floorMatch[2]), Number(floorMatch[3])];

  // --- the node ExecStart will actually run: the first `node` on PATH ---
  const probe = spawnSync('node', ['--version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) {
    fail(
      `cannot resolve a runnable \`node\` on this unit's PATH to check its version — ${
        probe.error ? probe.error.message : `it exited ${probe.status}`
      }`,
    );
    return;
  }

  const actual = (probe.stdout ?? '').trim(); // e.g. "v24.3.0"
  const actualMatch = NODE_VERSION.exec(actual);
  if (!actualMatch) {
    fail(
      `could not parse the resolved node's version (got: ${JSON.stringify(actual)}); expected vX.Y.Z`,
    );
    return;
  }
  const version = [Number(actualMatch[1]), Number(actualMatch[2]), Number(actualMatch[3])];

  if (compareVersions(version, floor) < 0) {
    fail(
      `the \`node\` on this unit's PATH is ${actual}, below the required Node ${engines} ` +
        `(package.json engines.node). Point the Environment=PATH line in this unit at a ` +
        `Node ${engines} install — npm's engines check is only a warning, so an older node would ` +
        `otherwise build and run this dashboard silently.`,
    );
    return;
  }
}

main();

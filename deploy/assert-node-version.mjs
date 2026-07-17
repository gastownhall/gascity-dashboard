// Refuse to start when the `node` this unit will run is older than the repo's
// engines floor.
//
// The unit runs `/usr/bin/env node …`, i.e. the FIRST `node` on the unit's
// Environment=PATH. CI and package.json (`engines.node`) require Node >= 24, but
// `npm install` only WARNS on an older runtime — nothing stops an older node,
// first on PATH, from building and then running in production. This guard is the
// fail-fast: it asks that SAME `node` for its version (resolved off PATH exactly
// as ExecStart resolves it, not the interpreter that happens to run this guard)
// and refuses the start when it is below the floor, naming both numbers and the
// unit line to fix.
//
// The floor comes from package.json `engines.node`, so the version lives in one
// place. Verified BOTH directions (a fake older node refuses, a new one passes)
// on real transient units in backend/test/deploy-unit.test.ts.

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

/** @param {string} msg */
function fail(msg) {
  console.error(`gas-city-dashboard: ${msg}`);
  process.exit(1);
}

// --- the required floor, read from package.json engines.node ---
let engines;
try {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  engines = pkg?.engines?.node;
} catch (err) {
  fail(`cannot read package.json to determine the required Node version — ${/** @type {Error} */ (err).message}`);
}
const floorMatch = typeof engines === 'string' ? engines.match(/(\d+)/) : null;
if (!floorMatch) {
  fail(
    `package.json engines.node is missing or unparseable (got: ${JSON.stringify(engines)}); cannot enforce a Node floor`,
  );
}
const floorMajor = Number(floorMatch[1]);

// --- the node ExecStart will actually run: the first `node` on PATH ---
const probe = spawnSync('node', ['--version'], { encoding: 'utf8' });
if (probe.error || probe.status !== 0) {
  fail(
    `cannot resolve a runnable \`node\` on this unit's PATH to check its version — ${
      probe.error ? probe.error.message : `it exited ${probe.status}`
    }`,
  );
}
const actual = (probe.stdout ?? '').trim(); // e.g. "v24.3.0"
const actualMatch = actual.match(/^v?(\d+)\./);
if (!actualMatch) {
  fail(`could not parse the resolved node's version (got: ${JSON.stringify(actual)})`);
}
const actualMajor = Number(actualMatch[1]);

if (actualMajor < floorMajor) {
  fail(
    `the \`node\` on this unit's PATH is ${actual}, below the required Node >= ${floorMajor} ` +
      `(package.json engines.node = "${engines}"). Point the Environment=PATH line in this unit at a ` +
      `Node >= ${floorMajor} install — npm's engines check is only a warning, so an older node would ` +
      `otherwise build and run this dashboard silently.`,
  );
}

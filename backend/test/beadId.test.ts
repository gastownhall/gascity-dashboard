import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { BEAD_ID_RE } from '../src/lib/beadId.js';

// Regression coverage for gascity-dashboard-bwp: the write-side regex
// was too narrow (only td/th/jt prefixes), causing dashboard 'close'
// actions on co-/gc-/agent-prefixed ids to bounce with HTTP 400.
//
// These cases exercise the shared regex used by run-link parsing and
// maintainer sling-state validation.

describe('BEAD_ID_RE — accept', () => {
  const accept = [
    'td-7t24i6',           // canonical td-prefixed
    'th-1234',             // th-prefixed
    'jt-abcdef',           // jt-prefixed
    'co-ysv',              // co-prefixed (gascity-dashboard-bwp report)
    'gc-123',              // gc-prefixed
    'agent-diagnostics-y84', // agent-prefixed with hyphens
    'gascity-dashboard-glw',
    'gascity-dashboard-37u.3', // bead-with-suffix
    'a',                   // single-char minimum
    'A1_b.c-d',            // mixed-case + every allowed separator
  ];
  for (const id of accept) {
    test(`accepts "${id}"`, () => {
      assert.equal(BEAD_ID_RE.test(id), true);
    });
  }
});

describe('BEAD_ID_RE — reject', () => {
  const reject = [
    '',                    // empty
    '-leading-hyphen',     // must start with alphanumeric
    '_leading-underscore', // must start with alphanumeric
    'has space',           // whitespace
    'has\ttab',
    'has\nnewline',
    "has'quote",
    'has"quote',
    'has;semi',
    'has$dollar',
    'has`backtick`',
    'has|pipe',
    'has&amp',
    'has/slash',
    'has\\backslash',
    'has(paren)',
    'has[bracket]',
    'has{brace}',
    'a'.repeat(65),        // length cap
  ];
  for (const id of reject) {
    test(`rejects ${JSON.stringify(id)}`, () => {
      assert.equal(BEAD_ID_RE.test(id), false);
    });
  }
});

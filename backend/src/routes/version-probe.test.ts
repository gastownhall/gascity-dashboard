import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseVersion } from './version-probe.js';

describe('parseVersion', () => {
  test('extracts the semver from `dolt version` output', () => {
    assert.equal(parseVersion('dolt version 2.0.7\n'), '2.0.7');
  });

  test('extracts the semver from `bd version` output', () => {
    assert.equal(
      parseVersion('bd version 1.0.4 (ce242a879: HEAD@ce242a879678)\n'),
      '1.0.4',
    );
  });

  test('returns null when no version token is present', () => {
    assert.equal(parseVersion('command not found'), null);
  });
});

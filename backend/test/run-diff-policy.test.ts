import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  RUN_REVIEWABLE_PATHS,
  classifyRunDiffFile,
  isReviewableRunDiffPath,
  isSafeRelativeGitPath,
} from '../src/runs/run-diff-policy.js';

describe('run diff reviewability policy', () => {
  test('exports git pathspecs that exclude top-level control-plane directories', () => {
    assert.deepEqual(RUN_REVIEWABLE_PATHS, [
      '--',
      ':/',
      ':(exclude,top).beads',
      ':(exclude,top).beads/**',
      ':(exclude,top).gc',
      ':(exclude,top).gc/**',
    ]);
  });

  test('string predicate matches the top-level control-plane exclusion', () => {
    assert.equal(isReviewableRunDiffPath('.beads'), false);
    assert.equal(isReviewableRunDiffPath('.beads/metadata.json'), false);
    assert.equal(isReviewableRunDiffPath('a/.gc/events.jsonl'), false);
    assert.equal(isReviewableRunDiffPath('"b/.gc/system/settings.json"'), false);

    assert.equal(isReviewableRunDiffPath('.gcfoo/settings.json'), true);
    assert.equal(isReviewableRunDiffPath('src/.gc/settings.json'), true);
    assert.equal(isReviewableRunDiffPath('src/app.ts'), true);
  });

  test('classifies changed files once for tracked and untracked diff paths', () => {
    assert.equal(classifyRunDiffFile('src/app.ts'), 'code');
    assert.equal(classifyRunDiffFile('src/app.test.tsx'), 'test');
    assert.equal(classifyRunDiffFile('docs/readme.md'), 'docs');
    assert.equal(classifyRunDiffFile('package.json'), 'config');
    assert.equal(classifyRunDiffFile('assets/logo.png'), 'other');
  });
});

describe('untracked git path safety guard', () => {
  // `isSafeRelativeGitPath` gates paths fed to the untracked-patch `git diff`
  // shell-out. Git itself only emits repo-relative paths, so the reject branches
  // are unreachable through normal git output — they exist as defense-in-depth
  // against compromised/malformed git output and are only exercisable directly.
  // Each rejection below isolates exactly one branch: neuter that branch and
  // only its case flips, so every assertion is mutation-biting.
  test('accepts ordinary repo-relative untracked paths', () => {
    for (const filePath of [
      'src/index.ts',
      'docs/plan.md',
      '.runtime/session_id',
      'a/b/c/deep.txt',
      'file-with..dots-but-no-segment.ts',
    ]) {
      assert.equal(isSafeRelativeGitPath(filePath), true, `expected safe: ${filePath}`);
    }
  });

  test('rejects the empty path (length-0 branch)', () => {
    assert.equal(isSafeRelativeGitPath(''), false);
  });

  test('rejects an absolute path (leading-slash branch)', () => {
    assert.equal(isSafeRelativeGitPath('/etc/passwd'), false);
    assert.equal(isSafeRelativeGitPath('/tmp/evil'), false);
  });

  test('rejects an embedded NUL byte (null-byte branch)', () => {
    assert.equal(isSafeRelativeGitPath('src/app.ts\0.png'), false);
    assert.equal(isSafeRelativeGitPath('\0'), false);
  });

  test('rejects a `..` escape segment without flagging `..` substrings', () => {
    // The split('/').includes('..') branch matches a whole `..` segment only —
    // a literal `..` inside a filename (asserted safe above) must still pass.
    assert.equal(isSafeRelativeGitPath('../outside'), false);
    assert.equal(isSafeRelativeGitPath('src/../../escape'), false);
    assert.equal(isSafeRelativeGitPath('a/b/..'), false);
  });
});

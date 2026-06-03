import express from 'express';
import type { RunExecutionPath } from 'gas-city-dashboard-shared';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { promisify } from 'node:util';
import { runsRouter } from '../src/routes/runs.js';

const execFileAsync = promisify(execFile);

describe('run diff route', () => {
  test('does not serve the old dashboard formula-run detail mirror', async () => {
    const { url, close } = await startApp(buildApp());
    try {
      const res = await fetch(`${url}/api/city/test-city/runs/gc-root`);
      assert.equal(res.status, 404);
    } finally {
      await close();
    }
  });

  test('returns unpushed, working tree, staged, and untracked changes for the server-owned execution path', async () => {
    const remote = await fs.mkdtemp(path.join(os.tmpdir(), 'run-diff-remote-'));
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'run-diff-'));
    await execFileAsync('git', ['-C', remote, 'init', '--bare']);
    await execFileAsync('git', ['-C', repo, 'init']);
    await fs.writeFile(path.join(repo, 'README.md'), 'base\n');
    await fs.mkdir(path.join(repo, '.beads'));
    await fs.mkdir(path.join(repo, '.gc'));
    await fs.writeFile(path.join(repo, '.beads', 'config.yaml'), 'tracked bead config\n');
    await fs.writeFile(path.join(repo, '.gc', 'settings.json'), '{}\n');
    await execFileAsync('git', [
      '-C',
      repo,
      'add',
      'README.md',
      '.beads/config.yaml',
      '.gc/settings.json',
    ]);
    await commit(repo);
    await execFileAsync('git', ['-C', repo, 'branch', '-M', 'main']);
    await execFileAsync('git', ['-C', repo, 'remote', 'add', 'origin', remote]);
    await execFileAsync('git', ['-C', repo, 'push', '-u', 'origin', 'main']);
    await fs.mkdir(path.join(repo, 'src'));
    await fs.writeFile(path.join(repo, 'src', 'committed.ts'), 'export const committed = true;\n');
    await execFileAsync('git', ['-C', repo, 'add', 'src/committed.ts']);
    await commit(repo, 'committed ahead');
    await fs.writeFile(path.join(repo, 'README.md'), 'base\nnext\n');
    await fs.writeFile(path.join(repo, '.beads', 'config.yaml'), 'tracked bead config changed\n');
    await fs.writeFile(path.join(repo, '.gc', 'settings.json'), '{"changed":true}\n');
    await fs.writeFile(path.join(repo, '.beads', 'identity.toml'), 'id = "local"\n');
    await fs.writeFile(path.join(repo, '.gc', 'events.jsonl'), '{}\n');
    await fs.mkdir(path.join(repo, '.runtime'));
    await fs.writeFile(path.join(repo, '.runtime', 'session_id'), 'runtime-bug-visible\n');
    await fs.writeFile(path.join(repo, 'src', 'index.ts'), 'export const run = true;\n');
    await execFileAsync('git', ['-C', repo, 'add', 'src/index.ts']);
    await fs.mkdir(path.join(repo, 'docs'));
    await fs.writeFile(path.join(repo, 'docs', 'plan.md'), '# Plan\n\nGenerated plan.\n');

    const { url, close } = await startApp(buildApp());
    try {
      const res = await postDiff(url, knownPath(repo), '?path=/tmp/evil');
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.kind, 'ok');
      assert.deepEqual(body.rootPath, { kind: 'known', path: await fs.realpath(repo) });
      assert.equal(body.comparison.kind, 'upstream');
      assert.equal(body.comparison.ref, 'origin/main');
      assert.deepEqual(body.changedFiles, [
        { path: '.runtime/session_id', status: '??', kind: 'other' },
        { path: 'docs/plan.md', status: '??', kind: 'docs' },
        { path: 'README.md', status: 'M', kind: 'docs' },
        { path: 'src/committed.ts', status: 'A', kind: 'code' },
        { path: 'src/index.ts', status: 'A', kind: 'code' },
      ]);
      assert.doesNotMatch(body.status.join('\n'), /\.beads|\.gc/);
      assert.match(body.patch, /^\+next$/m);
      assert.match(body.patch, /^\+export const committed = true;$/m);
      assert.match(body.patch, /^\+export const run = true;$/m);
      assert.match(body.patch, /^\+# Plan$/m);
      assert.match(body.patch, /^\+runtime-bug-visible$/m);
      assert.doesNotMatch(body.patch, /\.beads|\.gc/);
    } finally {
      await close();
      await fs.rm(repo, { recursive: true, force: true });
      await fs.rm(remote, { recursive: true, force: true });
    }
  });

  test('reports a HEAD comparison when no upstream branch is configured', async () => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'run-no-upstream-'));
    await execFileAsync('git', ['-C', repo, 'init']);
    await fs.writeFile(path.join(repo, 'README.md'), 'base\n');
    await execFileAsync('git', ['-C', repo, 'add', 'README.md']);
    await commit(repo);
    await fs.writeFile(path.join(repo, 'README.md'), 'base\nnext\n');
    await fs.mkdir(path.join(repo, 'docs'));
    await fs.writeFile(path.join(repo, 'docs', 'plan.md'), '# Plan\n');

    const { url, close } = await startApp(buildApp());
    try {
      const res = await postDiff(url, knownPath(repo));
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.kind, 'ok');
      assert.deepEqual(body.comparison, { kind: 'head', reason: 'no_upstream' });
      assert.deepEqual(body.changedFiles, [
        { path: 'docs/plan.md', status: '??', kind: 'docs' },
        { path: 'README.md', status: 'M', kind: 'docs' },
      ]);
      assert.match(body.patch, /^\+next$/m);
      assert.match(body.patch, /^\+# Plan$/m);
    } finally {
      await close();
      await fs.rm(repo, { recursive: true, force: true });
    }
  });

  test('reports path_unknown when direct supervisor detail has no execution folder', async () => {
    const { url, close } = await startApp(buildApp());
    try {
      const res = await postDiff(url, {
        kind: 'unavailable',
        reason: 'missing_cwd_and_rig_root',
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.kind, 'path_unknown');
      assert.deepEqual(body.rootPath, { kind: 'unavailable', reason: 'path_unknown' });
      assert.deepEqual(body.comparison, { kind: 'unavailable', reason: 'path_unknown' });
      assert.deepEqual(body.changedFiles, []);
    } finally {
      await close();
    }
  });

  test('quietly reports not_git for execution folders outside git', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'run-not-git-'));
    const { url, close } = await startApp(buildApp());
    try {
      const res = await postDiff(url, knownPath(dir));
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.kind, 'not_git');
      assert.deepEqual(body.rootPath, { kind: 'unavailable', reason: 'not_git' });
      assert.deepEqual(body.comparison, { kind: 'unavailable', reason: 'not_git' });
      assert.deepEqual(body.changedFiles, []);
    } finally {
      await close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  // gascity-dashboard-k2b8: when RUN_CWD_ALLOWED_ROOTS is configured, a
  // supervisor-supplied work_dir outside every sanctioned root must be
  // refused before `git -C <cwd>` runs — defense-in-depth on the dashboard's
  // last shell-read. The refusal surfaces as the existing not_git shape (the
  // cwd validation throws and the root probe is the first git call).
  test('k2b8: refuses a run cwd outside the configured allowlist', async () => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'run-allowlist-deny-'));
    await execFileAsync('git', ['-C', repo, 'init']);
    await fs.writeFile(path.join(repo, 'README.md'), 'base\n');
    await execFileAsync('git', ['-C', repo, 'add', 'README.md']);
    await commit(repo);
    await fs.writeFile(path.join(repo, 'README.md'), 'base\nnext\n');

    // The repo is a REAL git tree, but the allowlist sanctions an unrelated
    // root, so the diff must be refused. Because the cwd is a genuine repo,
    // `not_git` can only arise from the cwd refusal (the validation throws
    // before git runs) — were enforcement absent, the paired allow-test below
    // shows this exact setup yields kind 'ok'.
    const { url, close } = await startApp(
      buildApp(['/var/empty/sanctioned-root']),
    );
    try {
      const res = await postDiff(url, knownPath(repo));
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.kind, 'not_git', 'an out-of-allowlist cwd must not be read');
      assert.deepEqual(body.changedFiles, []);
      assert.equal(body.patch, '');
    } finally {
      await close();
      await fs.rm(repo, { recursive: true, force: true });
    }
  });

  test('k2b8: serves the diff when the run cwd is under a configured allowed root', async () => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'run-allowlist-allow-'));
    await execFileAsync('git', ['-C', repo, 'init']);
    await fs.writeFile(path.join(repo, 'README.md'), 'base\n');
    await execFileAsync('git', ['-C', repo, 'add', 'README.md']);
    await commit(repo);
    await fs.writeFile(path.join(repo, 'README.md'), 'base\nnext\n');

    // The cwd equals the sanctioned root, so the read proceeds normally.
    const { url, close } = await startApp(buildApp([repo]));
    try {
      const res = await postDiff(url, knownPath(repo));
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.kind, 'ok', 'an in-allowlist cwd must be served');
      assert.match(body.patch, /^\+next$/m);
    } finally {
      await close();
      await fs.rm(repo, { recursive: true, force: true });
    }
  });

  test('marks large local-change patches as truncated', async () => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'run-large-diff-'));
    await execFileAsync('git', ['-C', repo, 'init']);
    await fs.writeFile(path.join(repo, 'large.txt'), 'base\n');
    await execFileAsync('git', ['-C', repo, 'add', 'large.txt']);
    await commit(repo);
    await fs.writeFile(path.join(repo, 'large.txt'), `${'x'.repeat(700 * 1024)}\n`);

    const { url, close } = await startApp(buildApp());
    try {
      const res = await postDiff(url, knownPath(repo));
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.kind, 'ok');
      assert.equal(body.truncated, true);
      assert.ok(body.patch.length <= 512 * 1024);
    } finally {
      await close();
      await fs.rm(repo, { recursive: true, force: true });
    }
  });
});

async function commit(repo: string, message = 'base'): Promise<void> {
  await execFileAsync('git', [
    '-C',
    repo,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '-m',
    message,
  ]);
}

function buildApp(runCwdAllowedRoots: readonly string[] = []): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/city/test-city/runs', runsRouter({ runCwdAllowedRoots }));
  return app;
}

function startApp(app: express.Express): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

function knownPath(path: string): RunExecutionPath {
  return { kind: 'known', path };
}

function postDiff(
  baseUrl: string,
  executionPath: RunExecutionPath,
  query = '',
): Promise<Response> {
  return fetch(`${baseUrl}/api/city/test-city/runs/gc-root/diff${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ executionPath }),
  });
}

import { spawnSync } from 'node:child_process';
import { access, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const checkOnly = process.argv.includes('--check');
const heyApiConfigPath = path.resolve('backend/openapi-ts.config.ts');
const heyApiCliPath = path.resolve('node_modules/@hey-api/openapi-ts/bin/run.js');
// One generated supervisor client, owned by `shared`, re-exported through the
// `gas-city-dashboard-shared/gc-supervisor` subpath so backend, frontend, and
// the TUI all consume the same wire types from a single source.
const supervisorClientOutputPath = path.resolve('shared/src/generated/gc-supervisor-client');

async function generateHeyApiClient(toPath) {
  await rm(toPath, { recursive: true, force: true });
  const result = spawnSync(
    process.execPath,
    [heyApiCliPath, '--file', heyApiConfigPath, '--no-log-file'],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        GC_SUPERVISOR_HEY_API_OUTPUT: toPath,
      },
    },
  );
  if (result.status !== 0) {
    throw new Error(`@hey-api/openapi-ts failed with exit code ${result.status ?? 'unknown'}`);
  }
  await allowRfc3339OffsetDateTimes(toPath);
  await reexportZodSchemas(toPath);
}

// The single shared SDK does not run a response validator (see
// backend/openapi-ts.config.ts) — the browser must not reject valid-but-evolved
// supervisor responses (r43k). The zod response schemas are still generated so
// the backend can validate its narrow cities/status reads at the edge. Patch
// the generated date-time validators to accept RFC3339 offset timestamps.
async function allowRfc3339OffsetDateTimes(toPath) {
  const zodPath = path.join(toPath, 'zod.gen.ts');
  if (!(await exists(zodPath))) return;
  const content = await readFile(zodPath, 'utf8');
  const patched = content.replaceAll('z.iso.datetime()', 'z.iso.datetime({ offset: true })');
  if (patched === content) {
    throw new Error(
      `${path.relative(process.cwd(), zodPath)} did not contain generated date-time validators`,
    );
  }
  await writeFile(zodPath, patched);
}

// The generated barrel re-exports only the SDK and types. Re-export the zod
// response schemas too so the backend can import them through the
// `gas-city-dashboard-shared/gc-supervisor` subpath and validate its narrow
// cities/status reads explicitly (the shared SDK carries no validator). Frontend
// bundles tree-shake the unused schemas.
async function reexportZodSchemas(toPath) {
  const indexPath = path.join(toPath, 'index.ts');
  const zodPath = path.join(toPath, 'zod.gen.ts');
  if (!(await exists(indexPath)) || !(await exists(zodPath))) return;
  const content = await readFile(indexPath, 'utf8');
  const reexport = "export * from './zod.gen.js';";
  if (content.includes(reexport)) return;
  await writeFile(indexPath, `${content.trimEnd()}\n${reexport}\n`);
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

if (checkOnly) {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'gc-supervisor-openapi-'));
  const tmpHeyApiPath = path.join(tmpDir, 'gc-supervisor-client');
  try {
    await generateHeyApiClient(tmpHeyApiPath);
    await assertDirectoryMatches(tmpHeyApiPath, supervisorClientOutputPath);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
  console.log('generated gc supervisor client is up to date');
} else {
  await generateHeyApiClient(supervisorClientOutputPath);
  console.log(`generated ${path.relative(process.cwd(), supervisorClientOutputPath)}`);
}

async function assertDirectoryMatches(expectedPath, actualPath) {
  const [expected, actual] = await Promise.all([
    readDirectoryFiles(expectedPath),
    readDirectoryFiles(actualPath),
  ]);
  const expectedKeys = Object.keys(expected).sort();
  const actualKeys = Object.keys(actual).sort();
  if (JSON.stringify(expectedKeys) !== JSON.stringify(actualKeys)) {
    throw new Error(
      `${path.relative(process.cwd(), actualPath)} is out of date. Run npm run openapi:gc-supervisor:generate.`,
    );
  }
  for (const key of expectedKeys) {
    if (expected[key] !== actual[key]) {
      throw new Error(
        `${path.relative(process.cwd(), path.join(actualPath, key))} is out of date. Run npm run openapi:gc-supervisor:generate.`,
      );
    }
  }
}

async function readDirectoryFiles(rootPath, relative = '') {
  const currentPath = path.join(rootPath, relative);
  const entries = await readdir(currentPath, { withFileTypes: true });
  const files = {};
  for (const entry of entries) {
    const entryRelative = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      Object.assign(files, await readDirectoryFiles(rootPath, entryRelative));
      continue;
    }
    files[entryRelative] = await readFile(path.join(rootPath, entryRelative), 'utf8');
  }
  return files;
}

import { access, readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@hey-api/client-fetch';

const rootPackageUrl = new URL('../../package.json', import.meta.url);
const backendPackageUrl = new URL('../package.json', import.meta.url);
const ciWorkflowUrl = new URL('../../.github/workflows/ci.yml', import.meta.url);
const eslintConfigUrl = new URL('../../eslint.config.mjs', import.meta.url);
const heyApiConfigUrl = new URL('../openapi-ts.config.ts', import.meta.url);
const backendTsconfigUrl = new URL('../tsconfig.json', import.meta.url);
const backendTestTsconfigUrl = new URL('../tsconfig.test.json', import.meta.url);
const frontendPackageUrl = new URL('../../frontend/package.json', import.meta.url);
const frontendTsconfigUrl = new URL('../../frontend/tsconfig.json', import.meta.url);
const gcClientUrl = new URL('../src/gc-client.ts', import.meta.url);
const deletedGcSupervisorDecodersUrl = new URL('../src/gc-supervisor-decoders.ts', import.meta.url);
const generatorUrl = new URL('../../scripts/generate-gc-supervisor-client.mjs', import.meta.url);
const generatedClientUrl = new URL('../src/generated/gc-supervisor-client/', import.meta.url);
const frontendGeneratedClientUrl = new URL(
  '../../frontend/src/generated/gc-supervisor-client/',
  import.meta.url,
);
const sharedIndexUrl = new URL('../../shared/src/index.ts', import.meta.url);
const sharedDashboardBeadsUrl = new URL('../../shared/src/dashboard-beads.ts', import.meta.url);
const sharedDashboardSessionsUrl = new URL(
  '../../shared/src/dashboard-sessions.ts',
  import.meta.url,
);
const sharedAgentsUrl = new URL('../../shared/src/gc-agents.ts', import.meta.url);
const sharedRigsUrl = new URL('../../shared/src/gc-rigs.ts', import.meta.url);
const sharedFormulaRunsUrl = new URL('../../shared/src/formula-runs.ts', import.meta.url);
const runtimeCompatUrl = new URL('../src/types/hey-api-client-fetch-compat.d.ts', import.meta.url);
const frontendRuntimeCompatUrl = new URL(
  '../../frontend/src/types/hey-api-client-fetch-compat.d.ts',
  import.meta.url,
);
const legacyGeneratedTypesUrl = new URL('../src/generated/gc-supervisor.ts', import.meta.url);
const legacyGeneratedSchemasUrl = new URL(
  '../src/generated/gc-supervisor-schemas.ts',
  import.meta.url,
);

test('gc supervisor generated-client tooling runs on Node 22.13 or newer', async () => {
  const rootPackage = JSON.parse(await readFile(rootPackageUrl, 'utf8')) as {
    engines?: { node?: string };
    devDependencies?: Record<string, string>;
  };
  const ciWorkflow = await readFile(ciWorkflowUrl, 'utf8');

  assert.equal(rootPackage.engines?.node, '>=22.13.0');
  assert.match(ciWorkflow, /node-version:\s*'22\.x'/);
  assert.match(ciWorkflow, /typecheck \+ tests \(node 22\)/);
  assert.ok(rootPackage.devDependencies?.['@hey-api/openapi-ts']);
});

test('gc supervisor client generation has no legacy openapi-typescript pipeline', async () => {
  const rootPackage = JSON.parse(await readFile(rootPackageUrl, 'utf8')) as {
    devDependencies?: Record<string, string>;
  };
  const backendPackage = JSON.parse(await readFile(backendPackageUrl, 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  const generator = await readFile(generatorUrl, 'utf8');

  assert.equal(rootPackage.devDependencies?.['openapi-typescript'], undefined);
  assert.equal(backendPackage.dependencies?.['openapi-fetch'], undefined);
  assert.equal(backendPackage.dependencies?.ajv, undefined);
  assert.doesNotMatch(generator, /openapi-typescript/);
  assert.doesNotMatch(generator, /gc-supervisor-schemas/);
  assert.equal(await exists(legacyGeneratedTypesUrl), false);
  assert.equal(await exists(legacyGeneratedSchemasUrl), false);
});

test('gc supervisor hey-api generator config is committed', async () => {
  const config = await readFile(heyApiConfigUrl, 'utf8');
  const backendPackage = JSON.parse(await readFile(backendPackageUrl, 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  const frontendPackage = JSON.parse(await readFile(frontendPackageUrl, 'utf8')) as {
    dependencies?: Record<string, string>;
  };

  assert.match(config, /defineConfig/);
  assert.match(config, /backend\/openapi\/gc-supervisor\.openapi\.json/);
  assert.match(config, /@hey-api\/client-fetch/);
  assert.match(config, /bundle:\s*false/);
  assert.match(config, /@hey-api\/typescript/);
  assert.match(config, /@hey-api\/sdk/);
  assert.ok(backendPackage.dependencies?.['@hey-api/client-fetch']);
  assert.ok(frontendPackage.dependencies?.['@hey-api/client-fetch']);
  assert.ok(frontendPackage.dependencies?.zod);
});

test('gc supervisor fetch runtime compatibility is ambient-only and not a runtime path alias', async () => {
  const backendTsconfig = await readFile(backendTsconfigUrl, 'utf8');
  const frontendTsconfig = await readFile(frontendTsconfigUrl, 'utf8');
  const compat = await readFile(runtimeCompatUrl, 'utf8');
  const frontendCompat = await readFile(frontendRuntimeCompatUrl, 'utf8');

  assert.doesNotMatch(backendTsconfig, /"@hey-api\/client-fetch"/);
  assert.doesNotMatch(frontendTsconfig, /"@hey-api\/client-fetch"/);
  assert.match(backendTsconfig, /"include": \["src"\]/);
  assert.match(compat, /declare module '@hey-api\/client-fetch'/);
  assert.match(frontendCompat, /declare module '@hey-api\/client-fetch'/);
  assert.match(compat, /responseValidator\?: \(data: unknown\) => Promise<unknown>/);
  assert.match(frontendCompat, /responseValidator\?: \(data: unknown\) => Promise<unknown>/);
  assert.match(compat, /sse:\s*\{/);
  assert.match(frontendCompat, /sse:\s*\{/);
});

test('published fetch runtime executes generated response validators for HTTP calls', async () => {
  const originalFetch = globalThis.fetch;
  let validatorCalls = 0;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    })) as typeof fetch;

  try {
    const client = createClient({
      baseUrl: 'http://gc-supervisor.test',
      responseStyle: 'fields',
      throwOnError: false,
    });
    const result = await client.get<{ ok: boolean }, never>({
      responseValidator: async (data) => {
        validatorCalls += 1;
        assert.deepEqual(data, { ok: true });
      },
      url: '/health',
    });

    assert.equal(validatorCalls, 1);
    assert.deepEqual(result.data, { ok: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('gc supervisor generation validates backend responses but not frontend (r43k)', async () => {
  const config = await readFile(heyApiConfigUrl, 'utf8');
  const backendSdk = await readFile(new URL('sdk.gen.ts', generatedClientUrl), 'utf8');
  const frontendSdk = await readFile(new URL('sdk.gen.ts', frontendGeneratedClientUrl), 'utf8');
  const backendFiles = await readTsFiles(generatedClientUrl);
  const frontendFiles = await readTsFiles(frontendGeneratedClientUrl);
  const backendZod = backendFiles.find(({ path }) => path === 'zod.gen.ts');
  const frontendZod = frontendFiles.find(({ path }) => path === 'zod.gen.ts');

  // The config branches validation on the output tree: zod for the backend's
  // narrow cities/status reads, none for the browser's broad direct reads.
  assert.match(config, /name:\s*'@hey-api\/sdk'/);
  assert.match(config, /response:\s*isFrontendClient\s*\?\s*false\s*:\s*'zod'/);
  assert.match(config, /name:\s*'zod'/);

  // Backend: zod schemas + a response validator in every operation.
  assert.ok(backendZod, 'backend zod.gen.ts should be generated from the supervisor schema');
  assert.match(backendZod.source, /from 'zod'/);
  assert.match(backendSdk, /responseValidator:/);

  // Frontend: no zod schemas, no response validation (r43k — the browser
  // trusts the supervisor and must not reject valid-but-evolved responses).
  assert.equal(frontendZod, undefined, 'frontend must not generate a zod.gen.ts');
  assert.doesNotMatch(frontendSdk, /responseValidator:/);
});

test('gc supervisor generated client post-processing is limited to RFC3339 offset datetimes', async () => {
  const generator = await readFile(generatorUrl, 'utf8');

  assert.doesNotMatch(generator, /ts-nocheck/);
  assert.doesNotMatch(generator, /patchGeneratedClientForStrictTooling/);
  assert.doesNotMatch(generator, /source\.replace/);
  assert.match(generator, /allowRfc3339OffsetDateTimes/);
  assert.match(generator, /z\.iso\.datetime\(\{ offset: true \}\)/);
  for (const rootUrl of [generatedClientUrl, frontendGeneratedClientUrl]) {
    for (const { path, source } of await readTsFiles(rootUrl)) {
      assert.doesNotMatch(
        source,
        /@ts-nocheck/,
        `${path} should be generator output without ts-nocheck`,
      );
    }
  }
});

test('gc supervisor generated client is covered by typecheck and lint gates', async () => {
  const backendTsconfig = await readFile(backendTsconfigUrl, 'utf8');
  const backendTestTsconfig = await readFile(backendTestTsconfigUrl, 'utf8');
  const frontendTsconfig = await readFile(frontendTsconfigUrl, 'utf8');
  const eslintConfig = await readFile(eslintConfigUrl, 'utf8');
  const rootPackage = JSON.parse(await readFile(rootPackageUrl, 'utf8')) as {
    scripts?: Record<string, string>;
  };

  assert.doesNotMatch(backendTsconfig, /src\/generated\/gc-supervisor-client/);
  assert.doesNotMatch(backendTestTsconfig, /src\/generated\/gc-supervisor-client/);
  assert.doesNotMatch(frontendTsconfig, /src\/generated\/gc-supervisor-client/);
  assert.doesNotMatch(eslintConfig, /backend\/src\/generated/);
  assert.doesNotMatch(eslintConfig, /frontend\/src\/generated/);
  assert.match(rootPackage.scripts?.typecheck ?? '', /typecheck:src/);
  assert.match(rootPackage.scripts?.typecheck ?? '', /typecheck:test/);
  assert.match(rootPackage.scripts?.lint ?? '', /--max-warnings=0/);
});

test('gc supervisor generated output imports the official fetch runtime instead of bundling patched runtime files', async () => {
  // Backend carries zod.gen.ts (response validation); frontend does not (r43k).
  const expectedPaths = {
    [generatedClientUrl.href]: [
      'client.gen.ts',
      'index.ts',
      'sdk.gen.ts',
      'types.gen.ts',
      'zod.gen.ts',
    ],
    [frontendGeneratedClientUrl.href]: ['client.gen.ts', 'index.ts', 'sdk.gen.ts', 'types.gen.ts'],
  };
  for (const rootUrl of [generatedClientUrl, frontendGeneratedClientUrl]) {
    const generatedFiles = await readTsFiles(rootUrl);
    const generatedPaths = generatedFiles.map(({ path }) => path).sort();
    const client = generatedFiles.find(({ path }) => path === 'client.gen.ts');
    const sdk = generatedFiles.find(({ path }) => path === 'sdk.gen.ts');

    assert.deepEqual(generatedPaths, expectedPaths[rootUrl.href]);
    assert.match(client?.source ?? '', /from '@hey-api\/client-fetch'/);
    assert.match(sdk?.source ?? '', /from '@hey-api\/client-fetch'/);
    assert.equal(
      generatedPaths.some((path) => path.startsWith('client/')),
      false,
    );
    assert.equal(
      generatedPaths.some((path) => path.startsWith('core/')),
      false,
    );
  }
});

test('gc supervisor generator checks backend and frontend generated clients', async () => {
  const generator = await readFile(generatorUrl, 'utf8');

  assert.match(generator, /backend\/src\/generated\/gc-supervisor-client/);
  assert.match(generator, /frontend\/src\/generated\/gc-supervisor-client/);
  assert.match(generator, /for \(const output of supervisorClientOutputs\)/);
});

test('GcClient uses the generated hey-api SDK instead of the legacy openapi-fetch paths client', async () => {
  const source = await readFile(gcClientUrl, 'utf8');

  assert.match(source, /generated\/gc-supervisor-client\/sdk\.gen/);
  assert.match(source, /from '@hey-api\/client-fetch'/);
  assert.doesNotMatch(source, /generated\/gc-supervisor-client\/client\//);
  assert.doesNotMatch(source, /\bstream[A-Z][A-Za-z]+\b/);
  assert.doesNotMatch(source, /openapi-fetch/);
  assert.doesNotMatch(source, /generated\/gc-supervisor\.js/);
  assert.doesNotMatch(source, /\bClient<paths>\b/);
  assert.doesNotMatch(source, /\bSUPERVISOR_PATHS\b/);
  assert.doesNotMatch(source, /\.GET\(/);
});

test('GcClient does not mirror supervisor EVENT history, and uses no deleted mail/event DTOs', async () => {
  const source = await readFile(gcClientUrl, 'utf8');

  // The deleted shared mail/event DTOs must never reappear in the backend
  // client — supervisor wire shapes are the generated types now.
  assert.doesNotMatch(source, /\bGcMailList\b/);
  assert.doesNotMatch(source, /\bGcEventList\b/);

  // Event history stays browser-direct: clients read the supervisor event
  // stream through the transport proxy, so the backend must NOT re-mirror it.
  assert.doesNotMatch(source, /\bgetV0CityByCityNameEvents\b/);
  assert.doesNotMatch(source, /\blistEvents\s*\(/);
  assert.doesNotMatch(source, /\bgetV0CityByCityNameMail\b/);
  assert.doesNotMatch(source, /\blistMail\s*\(/);
});

test('GcClient is limited to dashboard host-local supervisor reads', async () => {
  const source = await readFile(gcClientUrl, 'utf8');
  const sharedIndex = await readFile(sharedIndexUrl, 'utf8');

  assert.equal(await exists(sharedAgentsUrl), false);
  assert.doesNotMatch(sharedIndex, /gc-agents/);
  assert.equal(await exists(sharedRigsUrl), false);
  assert.doesNotMatch(sharedIndex, /gc-rigs/);
  assert.equal(await exists(sharedFormulaRunsUrl), false);
  assert.doesNotMatch(sharedIndex, /formula-runs/);
  assert.equal(await exists(deletedGcSupervisorDecodersUrl), false);

  assert.match(source, /\bgetV0Cities\b/);
  assert.match(source, /\bgetV0CityByCityNameStatus\b/);
  assert.match(source, /\bStatusBody\b/);
  assert.match(source, /\bSupervisorCity\b/);

  assert.doesNotMatch(source, /\bGcAgent\b/);
  assert.doesNotMatch(source, /\bGcAgentList\b/);
  assert.doesNotMatch(source, /\bGcRig\b/);
  assert.doesNotMatch(source, /\bGcRigList\b/);
  assert.doesNotMatch(source, /\bGcStatus\b/);
  assert.doesNotMatch(source, /\bGcFormulaRun\b/);
  assert.doesNotMatch(source, /\bGcFormulaRunList\b/);
  assert.doesNotMatch(source, /\bGcFormulaRunsResponse\b/);
  assert.doesNotMatch(source, /\bGcOrdersFeedResponse\b/);
  assert.doesNotMatch(source, /\bGcOrderHistory(List|Detail|Entry)\b/);
  assert.doesNotMatch(source, /\blistFormulaRunsByName\s*\(/);
  assert.doesNotMatch(source, /\blistOrdersFeed\s*\(/);
  assert.doesNotMatch(source, /\blistOrderHistory\s*\(/);
  assert.doesNotMatch(source, /\bgetOrderHistoryDetail\s*\(/);
  assert.doesNotMatch(source, /\bFormulaFeedBody\b/);

  for (const method of [
    'listAgents',
    'listBeads',
    'listFormulaRuns',
    'listMail',
    'listRigs',
    'listSessions',
  ]) {
    assert.doesNotMatch(source, new RegExp(`\\basync ${method}\\s*\\(`));
  }
});

test('Maintainer sling does not reintroduce backend supervisor DTOs or GcClient writes', async () => {
  const clientSource = await readFile(gcClientUrl, 'utf8');
  const sharedClientTypes = await readFile(sharedDashboardSessionsUrl, 'utf8');
  const sharedIndex = await readFile(sharedIndexUrl, 'utf8');

  assert.doesNotMatch(clientSource, /\bpostV0CityByCityNameSling\b/);
  assert.doesNotMatch(clientSource, /\basync\s+sling\s*\(/);
  assert.doesNotMatch(clientSource, /\bwriteSling\s*\(/);
  assert.doesNotMatch(sharedClientTypes, /\bSlingInput\b/);
  assert.doesNotMatch(sharedClientTypes, /\bSlingResponse\b/);
  assert.match(sharedIndex, /maintainer-sling/);
});

test('shared projection inputs do not use Gc-named supervisor mirror types', async () => {
  const sharedBeads = await readFile(sharedDashboardBeadsUrl, 'utf8');
  const sharedClientTypes = await readFile(sharedDashboardSessionsUrl, 'utf8');

  assert.doesNotMatch(sharedBeads, /\bGcBead\b/);
  assert.doesNotMatch(sharedBeads, /\bGcBeadList\b/);
  assert.doesNotMatch(sharedClientTypes, /\bGcSession\b/);
  assert.doesNotMatch(sharedClientTypes, /\bGcSessionList\b/);
});

test('GcClient has no unused backend detail/transcript supervisor mirrors', async () => {
  const clientSource = await readFile(gcClientUrl, 'utf8');

  for (const method of ['getAgent', 'getBead', 'getRun', 'getFormulaDetail', 'fetchTranscript']) {
    assert.doesNotMatch(clientSource, new RegExp(`\\basync ${method}\\s*\\(`));
  }

  assert.doesNotMatch(clientSource, /\bgetV0CityByCityNameAgentByBase\b/);
  assert.doesNotMatch(clientSource, /\bgetV0CityByCityNameBeadById\b/);
  assert.doesNotMatch(clientSource, /\bgetV0CityByCityNameWorkflowByWorkflowId\b/);
  assert.doesNotMatch(clientSource, /\bgetV0CityByCityNameFormulasByName\b/);
  assert.doesNotMatch(clientSource, /\bgetV0CityByCityNameSessionByIdTranscript\b/);
});

async function exists(url: URL): Promise<boolean> {
  try {
    await access(url);
    return true;
  } catch {
    return false;
  }
}

async function readTsFiles(
  rootUrl: URL,
  relative = '',
): Promise<Array<{ path: string; source: string }>> {
  const currentUrl = new URL(relative, rootUrl);
  const entries = await readdir(currentUrl, { withFileTypes: true });
  const files: Array<{ path: string; source: string }> = [];
  for (const entry of entries) {
    const childRelative = `${relative}${entry.name}${entry.isDirectory() ? '/' : ''}`;
    if (entry.isDirectory()) {
      files.push(...(await readTsFiles(rootUrl, childRelative)));
      continue;
    }
    if (!entry.name.endsWith('.ts')) continue;
    const source = await readFile(new URL(childRelative, rootUrl), 'utf8');
    files.push({ path: childRelative, source });
  }
  return files;
}

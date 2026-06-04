import { defineConfig } from '@hey-api/openapi-ts';

const outputPath =
  process.env.GC_SUPERVISOR_HEY_API_OUTPUT ?? './shared/src/generated/gc-supervisor-client';

// One generated SDK lives in `shared/` and is imported by BOTH the browser and
// the backend, so the SDK must not bake a zod response validator into every
// operation. The browser reads the full, open-ended supervisor surface directly
// (events with a growing set of types, beads, mail, sessions); strict zod
// re-validation against this point-in-time OpenAPI snapshot rejected
// valid-but-evolved responses — e.g. event types added to the supervisor after
// the snapshot was captured — blanking live surfaces with "gc supervisor
// response failed validation" (r43k). The browser trusts the supervisor (its
// source of truth) and must not re-validate.
//
// The zod response schemas are still generated so the backend can validate its
// own narrow, stable slice (cities, status) at the edge — explicitly, in
// GcClient (see backend/src/gc-client.ts), not through the shared SDK.

export default defineConfig({
  input: './backend/openapi/gc-supervisor.openapi.json',
  output: {
    path: outputPath,
    // Emit explicit `.js` extensions on generated relative imports so the
    // compiled ESM output resolves under Node's native ESM loader
    // (`node backend/dist/server.js`), not only under a bundler/tsx. Without
    // this, the production build crashes at startup with ERR_MODULE_NOT_FOUND
    // on the extensionless `./client.gen` / `./sdk.gen` / `./zod.gen` imports.
    importFileExtension: '.js',
  },
  plugins: [
    {
      name: '@hey-api/client-fetch',
      bundle: false,
    },
    '@hey-api/typescript',
    {
      name: '@hey-api/sdk',
      validator: {
        request: false,
        response: false,
      },
    },
    {
      name: 'zod',
      requests: false,
      responses: true,
    },
  ],
});

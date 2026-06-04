import { defineConfig } from '@hey-api/openapi-ts';

const outputPath =
  process.env.GC_SUPERVISOR_HEY_API_OUTPUT ?? './backend/src/generated/gc-supervisor-client';

// The two consumers read the supervisor at different breadths, so they validate
// differently:
//   - frontend (browser): reads the full, open-ended supervisor surface directly
//     (events with a growing set of types, beads, mail, sessions). Strict zod
//     re-validation against this point-in-time OpenAPI snapshot rejected
//     valid-but-evolved responses — e.g. event types added to the supervisor
//     after the snapshot was captured — blanking live surfaces with
//     "gc supervisor response failed validation" (r43k). The browser trusts the
//     supervisor (its source of truth) and skips response validation.
//   - backend: reads only a narrow, stable slice (cities, status) and validates
//     it at its edge; GcClient surfaces those zod errors as friendly messages.
const isFrontendClient = outputPath.includes('frontend');

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
        response: isFrontendClient ? false : 'zod',
      },
    },
    // zod response schemas exist only to back the sdk response validator, so
    // they are generated for the backend client only.
    ...(isFrontendClient
      ? []
      : [
          {
            name: 'zod' as const,
            requests: false,
            responses: true,
          },
        ]),
  ],
});

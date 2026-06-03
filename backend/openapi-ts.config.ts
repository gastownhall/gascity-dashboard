import { defineConfig } from '@hey-api/openapi-ts';

const outputPath =
  process.env.GC_SUPERVISOR_HEY_API_OUTPUT ??
  './backend/src/generated/gc-supervisor-client';

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
        response: 'zod',
      },
    },
    {
      name: 'zod',
      requests: false,
      responses: true,
    },
  ],
});

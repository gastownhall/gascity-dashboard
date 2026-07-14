interface ImportMetaEnv {
  readonly VITE_GC_SUPERVISOR_URL?: string;
  /** Vite's built-in dev-mode flag — gates /reef's `?fixture=` URL contract
   *  (frontend/src/aquarium/page/fixtureMode.ts) so it can never serve
   *  synthetic data from a production build. */
  readonly DEV: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

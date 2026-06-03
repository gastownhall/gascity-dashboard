// Resolves the TUI's runtime target from env/argv. Mirrors the web client's
// no-silent-fallback stance (frontend/src/api/cityBase.ts): a city-scoped
// surface with no city is a bug, not a default-to-first-city fallback.

import { CITY_NAME_RE } from 'gas-city-dashboard-shared';

export interface TuiConfig {
  /** Backend origin, e.g. http://127.0.0.1:8081 (the backend binds 127.0.0.1). */
  readonly baseUrl: string;
  /** Active city; every read/stream rides /api/city/:cityName/*. */
  readonly city: string;
  /** Mayor-companion mode: open on the truncated overview (set by the launcher's
   *  --split/--target via --compact). */
  readonly compact: boolean;
  /** Whether the TUI grabs the mouse for wheel scrolling. `--no-mouse` turns it
   *  off so tmux keeps the mouse (drag-resize a pinned panel); keyboard nav is
   *  unaffected. */
  readonly mouse: boolean;
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:8081';

/** Reads `--city=<name>` from argv, falling back to GC_CITY_NAME. */
function resolveCity(argv: readonly string[], env: NodeJS.ProcessEnv): string {
  const flag = argv.find((a) => a.startsWith('--city='));
  const city = flag ? flag.slice('--city='.length) : env.GC_CITY_NAME;
  if (!city) {
    throw new Error(
      'No city resolved. Pass --city=<name> or set GC_CITY_NAME ' +
        '(source .env.local first: `set -a; . ./.env.local; set +a`).',
    );
  }
  if (!CITY_NAME_RE.test(city)) {
    throw new Error(`Invalid city name: ${city}`);
  }
  return city;
}

export function resolveConfig(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): TuiConfig {
  return {
    baseUrl: (env.DASHBOARD_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, ''),
    city: resolveCity(argv, env),
    compact: argv.includes('--compact'),
    mouse: !argv.includes('--no-mouse'),
  };
}

// Reads the app's OKLCH theme tokens (frontend/src/styles/index.css) off the
// live DOM so the canvas palette (render/palette.ts's buildScenePalette)
// stays a single source of truth with the rest of the app instead of a
// second hardcoded color table drifting out of sync.

/** Bare token names, without the leading `--`. Matches
 *  render/palette.ts's expected `tokens` record keys. */
const TOKEN_NAMES = [
  'surface',
  'fg',
  'fg-muted',
  'fg-faint',
  'rule',
  'accent',
  'ok',
  'warn',
] as const;

/**
 * Read the current theme's CSS custom properties as bare OKLCH triplets
 * (e.g. `"96% 0.012 75"`), trimmed. `buildScenePalette` wraps each in
 * `oklch(...)` itself — this stays a pure DOM read with no color-string
 * assembly, so a token rename only needs a change here, not in every
 * painter. Missing/empty tokens pass through as `''`, never a fabricated
 * fallback color.
 */
export function readThemeTokens(
  root: HTMLElement = document.documentElement,
): Record<string, string> {
  const style = getComputedStyle(root);
  const tokens: Record<string, string> = {};
  for (const name of TOKEN_NAMES) {
    tokens[name] = style.getPropertyValue(`--${name}`).trim();
  }
  return tokens;
}

/** The app's single typeface stack, read off `<body>` so the canvas text
 *  layer never hardcodes a font list that could drift from styles/index.css. */
export function readBodyFontFamily(body: HTMLElement = document.body): string {
  return getComputedStyle(body).fontFamily;
}

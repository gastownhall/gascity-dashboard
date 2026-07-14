// OKLCH color string math for the render layer. palette.ts emits every color
// in the canonical form `oklch(L% C H)` or `oklch(L% C H / A)`, so painters
// can derive two-tone fills, fins, and fog blends without a color library.
// Parsing anything else is a logic bug and throws (fail fast, never mask).

import { clamp, clamp01, lerp } from './mathUtil';

export interface Oklch {
  /** lightness percent 0..100 */
  l: number;
  /** chroma */
  c: number;
  /** hue degrees */
  h: number;
  /** alpha 0..1 */
  alpha: number;
}

const OKLCH_RE = /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)$/;

export function parseOklch(color: string): Oklch {
  const m = OKLCH_RE.exec(color);
  if (m === null || m[1] === undefined || m[2] === undefined || m[3] === undefined) {
    throw new Error(`render/oklch: not a canonical oklch() string: ${JSON.stringify(color)}`);
  }
  return {
    l: Number(m[1]),
    c: Number(m[2]),
    h: Number(m[3]),
    alpha: m[4] === undefined ? 1 : Number(m[4]),
  };
}

export function formatOklch(o: Oklch): string {
  const base = `${round3(o.l)}% ${round3(o.c)} ${round3(o.h)}`;
  return o.alpha >= 1 ? `oklch(${base})` : `oklch(${base} / ${round3(o.alpha)})`;
}

/** Shift lightness by deltaPct (clamped to 0..100), preserving chroma/hue/alpha. */
export function adjustL(color: string, deltaPct: number): string {
  const o = parseOklch(color);
  return formatOklch({ ...o, l: clamp(o.l + deltaPct, 0, 100) });
}

/**
 * Shift lightness by deltaPct and scale chroma by chromaScale (both preserving
 * hue/alpha). A lit belly is lighter AND less saturated than the flank; a tense
 * body is darker AND more saturated. One pass, no color library.
 */
export function adjustLC(color: string, deltaPct: number, chromaScale: number): string {
  const o = parseOklch(color);
  return formatOklch({
    ...o,
    l: clamp(o.l + deltaPct, 0, 100),
    c: Math.max(0, o.c * chromaScale),
  });
}

/** Replace alpha outright. */
export function withAlpha(color: string, alpha: number): string {
  const o = parseOklch(color);
  return formatOklch({ ...o, alpha: clamp01(alpha) });
}

/** Override hue and chroma, preserving lightness and alpha — retints a base
 * pigment to a rig's identity hue while keeping the value that carries form. */
export function withHueChroma(color: string, h: number, c: number): string {
  const o = parseOklch(color);
  return formatOklch({ ...o, h, c: Math.max(0, c) });
}

/**
 * Atmospheric haze: pull lightness, chroma and alpha toward `haze` by t, but
 * KEEP the colour's own hue. A receding fish desaturates and lightens into the
 * water's value; it must never rotate through unrelated hues, which the naive
 * hue lerp in mixOklch would do for a wide-gamut rig palette (e.g. a gold fish
 * greening as it recedes). t=0 → color unchanged.
 */
export function hazeToward(color: string, haze: string, t: number): string {
  const oc = parseOklch(color);
  const oh = parseOklch(haze);
  const k = clamp01(t);
  return formatOklch({
    l: lerp(oc.l, oh.l, k),
    c: lerp(oc.c, oh.c, k),
    h: oc.h,
    alpha: lerp(oc.alpha, oh.alpha, k),
  });
}

/** Linear mix a→b in OKLCH components (t=0 → a). Hues lerp directly; the
 * scene's aquatic hues all sit within one hemisphere so no wraparound. */
export function mixOklch(a: string, b: string, t: number): string {
  const oa = parseOklch(a);
  const ob = parseOklch(b);
  const k = clamp01(t);
  return formatOklch({
    l: lerp(oa.l, ob.l, k),
    c: lerp(oa.c, ob.c, k),
    h: lerp(oa.h, ob.h, k),
    alpha: lerp(oa.alpha, ob.alpha, k),
  });
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

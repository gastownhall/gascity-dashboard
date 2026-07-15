// Rig colour identity for /reef. On this route hue is a data channel: every
// session of a rig — and its beads — carries the rig's hue, so project
// ownership reads at a glance (DESIGN.md §7, the licensed colour-as-identity
// exception). The palette is a curated, vivid reef-fish set that deliberately
// excludes the maroon band (hue ~25) reserved for the overlay's One Mark
// ledger. Assignment is a pure hash of the rig key, so a rig keeps its colour
// across sessions and independent of which other rigs exist (geography-as-
// muscle-memory, applied to colour). The mayor's city stratum and unrigged
// agents carry no project, so they read neutral (null) against the coloured
// schools; state stays in pose, so the Greyscale Test still passes.

import { CITY_KEY, UNRIGGED_KEY } from '../contracts';
import { hashString } from './hash';
import { at } from './mathUtil';

/** maroon ledger hue (OKLCH degrees); reserved for the One Mark, never a fish */
export const MAROON_HUE = 25;

/** curated vivid reef-fish hues (OKLCH degrees), evenly spread across the
 * non-maroon arc [100, 338] so a busy city's many rigs collide on a shared hue
 * far less often (11 hues vs the old 6; ~21 live rigs). Ordered so ADJACENT
 * array indices are ~120° apart in hue — if the key hash lands two rigs on
 * neighbouring indices, their colours still read as clearly different. Every
 * hue sits well clear of the maroon ledger band (see the rigHue.test greyscale
 * guard) and of the neutral gold the unrigged/city strata carry. */
export const RIG_HUES: readonly number[] = [100, 243, 124, 267, 148, 290, 172, 314, 195, 338, 219];

/** flank chroma of a rig-coloured fish/pellet — vivid, tropical. The
 * countershade and status-shade maths scale this down per station. */
export const RIG_CHROMA = 0.14;

/**
 * Deterministic hue for a rig key, or null for the neutral strata (the mayor's
 * city and unrigged agents) which carry no project colour. Pure in the key — a
 * rig's colour is stable across sessions and does not depend on which other
 * rigs exist. Two rigs still collide on a hue once a city has more rigs than
 * curated hues (RIG_HUES.length); past that the legend/roster panel and the
 * per-formation coloured label carry the exact rig — hue is the coarse group,
 * not a unique per-rig key (there is no perceptually distinct hue-per-rig for
 * ~21 rigs).
 */
export function rigHue(key: string): number | null {
  if (key === CITY_KEY || key === UNRIGGED_KEY || key === '') return null;
  return at(RIG_HUES, hashString(`rig-hue:${key}`) % RIG_HUES.length);
}

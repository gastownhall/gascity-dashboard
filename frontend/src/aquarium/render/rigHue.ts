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

/** curated vivid reef-fish hues (OKLCH degrees) — teal, blue, violet, anthias
 * pink, gold, sea-green — ordered for neighbour separation. Every hue sits well
 * clear of the maroon ledger band (see the rigHue.test greyscale guard). */
export const RIG_HUES: readonly number[] = [195, 245, 300, 338, 100, 150];

/** flank chroma of a rig-coloured fish/pellet — vivid, tropical. The
 * countershade and status-shade maths scale this down per station. */
export const RIG_CHROMA = 0.14;

/**
 * Deterministic hue for a rig key, or null for the neutral strata (the mayor's
 * city and unrigged agents) which carry no project colour. Pure in the key — a
 * rig's colour is stable across sessions and does not depend on which other
 * rigs exist. Two rigs collide on a hue only when a city has more rigs than
 * curated hues; grow RIG_HUES if that becomes common.
 */
export function rigHue(key: string): number | null {
  if (key === CITY_KEY || key === UNRIGGED_KEY || key === '') return null;
  return at(RIG_HUES, hashString(`rig-hue:${key}`) % RIG_HUES.length);
}

// Deterministic hashing shared by derive/ (formation placement) and sim/
// (per-entity phase/speed variation). No Math.random, no clock reads — every
// caller seeds from a stable identity string (rig key, fish id, bead id).

/** FNV-1a 32-bit string hash. Always a non-negative integer in [0, 2^32). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Scramble a 32-bit integer into a stable unit interval [0, 1). */
export function hashUnit(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 0x100000000;
}

/** Map a hash seed deterministically into [min, max). */
export function hashRange(seed: number, min: number, max: number): number {
  return min + hashUnit(seed) * (max - min);
}

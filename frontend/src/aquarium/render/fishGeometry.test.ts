import { describe, expect, it } from 'vitest';
import type { AquariumPose, FishSpecies } from '../contracts';
import {
  SPECIES,
  attitudeForPose,
  bellyFactorFromPct,
  fishFins,
  fishHead,
  fishHull,
  fishSpine,
  speedFactorFor,
  swimPhaseFor,
} from './fishGeometry';
import type { FishSpine } from './fishGeometry';
import { TAU, at, type Pt } from './mathUtil';

const DEG = Math.PI / 180;
const ALL_SPECIES: readonly FishSpecies[] = ['pool', 'role', 'grouper'];

function spineFor(
  pose: AquariumPose,
  species: FishSpecies = 'role',
  phase = 1.3,
  speed = 1,
): FishSpine {
  return fishSpine(species, attitudeForPose(pose), phase, speed);
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function bodyAngle(spine: FishSpine): number {
  const nose = at(spine.points, 0);
  const tail = at(spine.points, spine.points.length - 1);
  // positive = nose up (y grows downward)
  return Math.atan2(-(nose.y - tail.y), nose.x - tail.x);
}

describe('fishSpine', () => {
  it('orders spine points nose→tail with x strictly decreasing (level pose)', () => {
    for (const species of ALL_SPECIES) {
      const spine = spineFor('working', species);
      expect(spine.points.length).toBe(SPECIES[species].stations.length);
      for (let i = 1; i < spine.points.length; i += 1) {
        expect(at(spine.points, i).x).toBeLessThan(at(spine.points, i - 1).x);
      }
    }
  });

  it('swim cycle is TAU-periodic and non-degenerate', () => {
    const attitude = attitudeForPose('working');
    const a = fishSpine('pool', attitude, 0.7, 1);
    const b = fishSpine('pool', attitude, 0.7 + TAU, 1);
    a.points.forEach((p, i) => {
      expect(p.x).toBeCloseTo(at(b.points, i).x, 9);
      expect(p.y).toBeCloseTo(at(b.points, i).y, 9);
    });
    const c = fishSpine('pool', attitude, 0.7 + Math.PI, 1);
    const maxDelta = Math.max(...a.points.map((p, i) => dist(p, at(c.points, i))));
    expect(maxDelta).toBeGreaterThan(0.5);
  });

  it('wave amplitude grows toward the tail', () => {
    const attitude = attitudeForPose('working');
    // sample the lateral envelope across a full cycle per station
    const amplitudeAt = (index: number): number => {
      let max = 0;
      for (let k = 0; k < 32; k += 1) {
        const spine = fishSpine('role', attitude, (k / 32) * TAU, 1);
        max = Math.max(max, Math.abs(at(spine.points, index).y));
      }
      return max;
    };
    expect(amplitudeAt(4)).toBeGreaterThan(amplitudeAt(2));
    expect(amplitudeAt(2)).toBeGreaterThan(amplitudeAt(0));
  });

  it('swimPhaseFor advances linearly with the clock at the species frequency', () => {
    const delta = swimPhaseFor('pool', 2, 1000) - swimPhaseFor('pool', 2, 0);
    expect(delta).toBeCloseTo(SPECIES.pool.tailFrequencyHz * TAU, 9);
    expect(swimPhaseFor('grouper', 0.5, 0)).toBe(0.5);
  });

  it('speedFactorFor normalizes against cruise speed and clamps to [0, 2]', () => {
    expect(speedFactorFor('pool', SPECIES.pool.cruiseSpeed)).toBe(1);
    expect(speedFactorFor('role', 0)).toBe(0);
    expect(speedFactorFor('role', 10_000)).toBe(2);
  });

  it('is deterministic: identical inputs give identical geometry', () => {
    const attitude = attitudeForPose('working');
    const s1 = fishSpine('grouper', attitude, 1.234, 0.8);
    const s2 = fishSpine('grouper', attitude, 1.234, 0.8);
    expect(s2).toEqual(s1);
    const h1 = fishHull(s1, 'grouper', 1.31);
    const h2 = fishHull(s2, 'grouper', 1.31);
    expect(h2).toEqual(h1);
    expect(fishFins(s2, h2, 1.234)).toEqual(fishFins(s1, h1, 1.234));
    expect(fishHead(s2, h2)).toEqual(fishHead(s1, h1));
  });
});

describe('fishHull', () => {
  it('closes the outline: bezier segments chain back to their start', () => {
    const spine = spineFor('working');
    const hull = fishHull(spine, 'role', 1);
    expect(hull.segments.length).toBe(hull.ring.length);
    for (let i = 0; i < hull.segments.length; i += 1) {
      const seg = at(hull.segments, i);
      const next = at(hull.segments, (i + 1) % hull.segments.length);
      expect(seg.to).toEqual(next.from);
    }
    expect(at(hull.segments, hull.segments.length - 1).to).toEqual(at(hull.segments, 0).from);
  });

  it('bellyFactor swells the mid-body monotonically, leaving nose and tail alone', () => {
    const spine = spineFor('working');
    const mid = Math.floor(spine.points.length / 2);
    const widthAt = (belly: number, index: number): number => {
      const hull = fishHull(spine, 'role', belly);
      return dist(at(hull.ventral, index), at(spine.points, index));
    };
    expect(widthAt(1.2, mid)).toBeGreaterThan(widthAt(1, mid));
    expect(widthAt(1.5, mid)).toBeGreaterThan(widthAt(1.2, mid));
    const last = spine.points.length - 1;
    expect(widthAt(1.5, 0)).toBeCloseTo(widthAt(1, 0), 6);
    expect(widthAt(1.5, last)).toBeCloseTo(widthAt(1, last), 6);
  });

  it('fins stay attached to the swollen hull', () => {
    const spine = spineFor('working');
    const pelvicRootY = (belly: number): number => {
      const hull = fishHull(spine, 'role', belly);
      return at(fishFins(spine, hull, 0).pelvic, 0).y;
    };
    // the belly swells downward; the pelvic root must ride the hull down
    expect(pelvicRootY(1.5)).toBeGreaterThan(pelvicRootY(1));
  });

  it('bellyFactorFromPct maps context pct to the documented swell', () => {
    expect(bellyFactorFromPct(undefined)).toBe(1);
    expect(bellyFactorFromPct(0)).toBe(1);
    expect(bellyFactorFromPct(62)).toBeCloseTo(1.31, 9);
    expect(bellyFactorFromPct(100)).toBeCloseTo(1.5, 9);
    expect(bellyFactorFromPct(250)).toBeCloseTo(1.5, 9);
  });
});

describe('species profiles', () => {
  it('mid-body width orders grouper > role > pool', () => {
    const maxWidth = (species: FishSpecies): number => {
      const spine = spineFor('working', species);
      const hull = fishHull(spine, species, 1);
      let max = 0;
      for (let i = 0; i < spine.points.length; i += 1) {
        max = Math.max(max, dist(at(hull.dorsal, i), at(hull.ventral, i)));
      }
      return max;
    };
    expect(maxWidth('grouper')).toBeGreaterThan(maxWidth('role'));
    expect(maxWidth('role')).toBeGreaterThan(maxWidth('pool'));
  });

  it('caudal fins are species-distinct: forked notch vs rounded/broad fan', () => {
    const caudalShape = (species: FishSpecies): { tipLen: number; midLen: number } => {
      const spine = spineFor('working', species, 0, 1);
      const hull = fishHull(spine, species, 1);
      const caudal = fishFins(spine, hull, 0).caudal;
      const peduncle = at(spine.points, spine.points.length - 1);
      return {
        tipLen: dist(at(caudal, 1), peduncle),
        midLen: dist(at(caudal, 2), peduncle),
      };
    };
    const pool = caudalShape('pool');
    expect(pool.midLen).toBeLessThan(pool.tipLen); // forked: concave notch
    const role = caudalShape('role');
    expect(role.midLen).toBeGreaterThan(role.tipLen); // rounded: convex fan
  });
});

describe('attitudes', () => {
  it('awaiting-input pitches the nose up 25–35° with an open mouth', () => {
    const spine = spineFor('awaiting-input', 'role', 0, 0);
    const angle = bodyAngle(spine);
    expect(angle).toBeGreaterThan(25 * DEG);
    expect(angle).toBeLessThan(35 * DEG);
    expect(at(spine.points, 0).y).toBeLessThan(at(spine.points, spine.points.length - 1).y);
    expect(attitudeForPose('awaiting-input').mouthOpen).toBe(true);
  });

  it('stalled treads nose-up 35–40° with a hollow eye', () => {
    const angle = bodyAngle(spineFor('stalled', 'role', 0, 0));
    expect(angle).toBeGreaterThan(35 * DEG);
    expect(angle).toBeLessThan(40 * DEG);
    expect(attitudeForPose('stalled').eye).toBe('hollow');
  });

  it('errored flips belly-up: dorsal fin and eye swap sides, eye is crossed', () => {
    const flipped = spineFor('errored', 'role', 0, 0);
    const flippedHull = fishHull(flipped, 'role', 1);
    const level = spineFor('working', 'role', 0, 0);
    const levelHull = fishHull(level, 'role', 1);
    expect(at(fishFins(flipped, flippedHull, 0).dorsal, 1).y).toBeGreaterThan(3);
    expect(at(fishFins(level, levelHull, 0).dorsal, 1).y).toBeLessThan(-3);
    expect(fishHead(flipped, flippedHull).eye.y).toBeGreaterThan(0);
    expect(fishHead(level, levelHull).eye.y).toBeLessThan(0);
    expect(attitudeForPose('errored').eye).toBe('cross');
  });

  it('rate-limited compresses the body to 0.85 and folds the fins', () => {
    const spine = spineFor('rate-limited', 'role', 0, 0);
    const length =
      at(spine.points, 0).x - at(spine.points, spine.points.length - 1).x;
    expect(length).toBeCloseTo(SPECIES.role.length * 0.85, 6);
    // perpendicular height of the fin peak above its base chord
    const peakHeight = (pose: AquariumPose): number => {
      const s = spineFor(pose, 'role', 0, 0);
      const hull = fishHull(s, 'role', 1);
      const dorsal = fishFins(s, hull, 0).dorsal;
      const base = at(dorsal, 0);
      const aft = at(dorsal, dorsal.length - 1);
      const peak = at(dorsal, 1);
      const chord = dist(base, aft) || 1;
      return (
        Math.abs(
          (aft.x - base.x) * (base.y - peak.y) - (base.x - peak.x) * (aft.y - base.y),
        ) / chord
      );
    };
    expect(peakHeight('rate-limited')).toBeLessThan(0.5 * peakHeight('working'));
  });

  it('asleep lies straight and still with closed eyes, dimmed', () => {
    const spine = spineFor('asleep', 'pool', 2.1, 1);
    for (const p of spine.points) {
      expect(Math.abs(p.y)).toBeLessThan(1e-9);
    }
    const attitude = attitudeForPose('asleep');
    expect(attitude.eye).toBe('closed');
    expect(attitude.dimmed).toBe(true);
    expect(attitude.finsFolded).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import type { ScenePalette } from '../contracts';
import { buildScenePalette } from './palette';
import { SPECIES, attitudeForPose, fishHead, fishHull, fishSpine } from './fishGeometry';
import { paintEyeDot, paintFace } from './fishFace';
import { countershadeColors } from './fishShading';

const TOKENS: Record<string, string> = {
  surface: '96% 0.012 75',
  fg: '18% 0.012 75',
  'fg-muted': '42% 0.014 75',
  'fg-faint': '52% 0.014 75',
  rule: '80% 0.012 75',
  accent: '40% 0.13 25',
  ok: '50% 0.085 150',
  warn: '60% 0.14 60',
};
const PALETTE: ScenePalette = buildScenePalette('light', TOKENS, 'serif');

interface Seg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}
interface Arc {
  x: number;
  y: number;
  r: number;
}

/** records straight segments (moveTo→lineTo) and arcs so the errored X can be
 * inspected geometrically. */
function recordingCtx(): { ctx: CanvasRenderingContext2D; segments: Seg[]; arcs: Arc[] } {
  const segments: Seg[] = [];
  const arcs: Arc[] = [];
  let cur = { x: 0, y: 0 };
  const stub = {
    lineCap: 'butt',
    beginPath(): void {},
    moveTo(x: number, y: number): void {
      cur = { x, y };
    },
    lineTo(x: number, y: number): void {
      segments.push({ ax: cur.x, ay: cur.y, bx: x, by: y });
      cur = { x, y };
    },
    quadraticCurveTo(): void {},
    arc(x: number, y: number, r: number): void {
      arcs.push({ x, y, r });
    },
    ellipse(): void {},
    fill(): void {},
    stroke(): void {},
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
  };
  return { ctx: stub as unknown as CanvasRenderingContext2D, segments, arcs };
}

describe('errored dead-eye (findings: X read as a stray scribble)', () => {
  it('draws a clean, centered X bounded inside a socket ring', () => {
    const spine = fishSpine('role', attitudeForPose('errored'), 0, 0);
    const hull = fishHull(spine, 'role', 1);
    const head = fishHead(spine, hull);
    const colors = countershadeColors(PALETTE, 'normal');
    const { ctx, segments, arcs } = recordingCtx();
    paintFace(ctx, head, attitudeForPose('errored'), SPECIES.role.noseBlunt, colors, 1);

    const eye = head.eye;
    const r = head.eyeRadius;
    const near = (a: number, b: number): boolean => Math.abs(a - b) < r * 0.08;
    // the X arms are the straight segments whose MIDPOINT sits on the eye
    const xArms = segments.filter(
      (s) => near((s.ax + s.bx) / 2, eye.x) && near((s.ay + s.by) / 2, eye.y),
    );
    expect(xArms.length).toBe(2);

    // the two arms cross: one descends left→right, the other rises (opposite
    // vertical slopes) — an unambiguous X, not a scribble
    const slopeSign = (s: Seg): number => Math.sign((s.by - s.ay) * (s.bx - s.ax));
    expect(slopeSign(xArms[0]!)).toBe(-slopeSign(xArms[1]!));

    // arms are equal length and centered, and every arm tip stays INSIDE the
    // socket ring (radius r) so nothing spills past the eye as a stray mark
    for (const arm of xArms) {
      const half = Math.hypot(arm.bx - arm.ax, arm.by - arm.ay) / 2;
      expect(half).toBeCloseTo(
        Math.hypot(xArms[0]!.bx - xArms[0]!.ax, xArms[0]!.by - xArms[0]!.ay) / 2,
        6,
      );
      for (const p of [
        { x: arm.ax, y: arm.ay },
        { x: arm.bx, y: arm.by },
      ]) {
        expect(Math.hypot(p.x - eye.x, p.y - eye.y)).toBeLessThan(r);
      }
    }

    // a bounding socket exists at the eye (radius ~r) — the dead eye is framed
    expect(
      arcs.some((a) => near(a.x, eye.x) && near(a.y, eye.y) && Math.abs(a.r - r) < r * 0.2),
    ).toBe(true);
  });
});

describe('cheap eye dot (below the full-face floor)', () => {
  it('draws an iris disc at the eye plus a smaller catchlight, and no gill or mouth', () => {
    const spine = fishSpine('role', attitudeForPose('working'), 0, 0);
    const hull = fishHull(spine, 'role', 1);
    const head = fishHead(spine, hull);
    const colors = countershadeColors(PALETTE, 'normal');
    const { ctx, segments, arcs } = recordingCtx();
    paintEyeDot(ctx, head, colors);

    // exactly the iris + its catchlight — no gill quad, no mouth line, no socket
    expect(arcs.length).toBe(2);
    expect(segments.length).toBe(0);

    const r = head.eyeRadius;
    const iris = arcs.find((a) => Math.abs(a.r - r) < r * 0.1);
    expect(iris).toBeDefined();
    expect(Math.hypot(iris!.x - head.eye.x, iris!.y - head.eye.y)).toBeLessThan(r * 0.1);

    // the catchlight is markedly smaller than the iris and sits off-centre
    const catchlight = arcs.find((a) => a.r < r * 0.6);
    expect(catchlight).toBeDefined();
    expect(Math.hypot(catchlight!.x - head.eye.x, catchlight!.y - head.eye.y)).toBeGreaterThan(0);
  });
});

// Fish face: eye (with a catchlight), gill crease, and mouth — the details
// that read at a ~150px close-up and separate a designed creature from a
// stock ellipse. The eye style and mouth carry pose (open gape = awaiting
// input, X-cross = errored, closed arc = asleep). Pure painter: all geometry
// arrives in fish-local coordinates from fishHead().

import type { FishHead } from './fishFins';
import type { FishAttitude } from './fishAttitude';
import type { CountershadeColors } from './fishShading';
import { TAU } from './mathUtil';

export function paintFace(
  ctx: CanvasRenderingContext2D,
  head: FishHead,
  attitude: FishAttitude,
  noseBlunt: number,
  colors: CountershadeColors,
  lineWidth: number,
): void {
  paintGill(ctx, head, colors.outline, lineWidth);
  paintMouth(ctx, head, attitude, noseBlunt, colors.outline, lineWidth);
  paintEye(ctx, head, attitude, colors, lineWidth);
}

function paintGill(
  ctx: CanvasRenderingContext2D,
  head: FishHead,
  outline: string,
  lineWidth: number,
): void {
  const bow = 1.5 * head.eyeRadius;
  ctx.strokeStyle = outline;
  ctx.lineWidth = lineWidth * 0.9;
  ctx.beginPath();
  ctx.moveTo(head.gillA.x, head.gillA.y);
  ctx.quadraticCurveTo(
    (head.gillA.x + head.gillB.x) / 2 - head.mouthDir.x * bow,
    (head.gillA.y + head.gillB.y) / 2 - head.mouthDir.y * bow,
    head.gillB.x,
    head.gillB.y,
  );
  ctx.stroke();
}

function paintMouth(
  ctx: CanvasRenderingContext2D,
  head: FishHead,
  attitude: FishAttitude,
  noseBlunt: number,
  outline: string,
  lineWidth: number,
): void {
  if (attitude.mouthOpen) {
    paintGape(ctx, head, outline);
    return;
  }
  // closed crease across the snout — heavier for a blunt grouper jaw
  ctx.strokeStyle = outline;
  ctx.lineWidth = lineWidth * (noseBlunt > 0.6 ? 2.3 : 1.1);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(head.mouthA.x, head.mouthA.y);
  ctx.lineTo(head.mouthB.x, head.mouthB.y);
  ctx.stroke();
  ctx.lineCap = 'butt';
}

/** upward gape: a dark rounded mouth cavity opening off the nose */
function paintGape(ctx: CanvasRenderingContext2D, head: FishHead, outline: string): void {
  const r = head.eyeRadius;
  const dir = head.mouthDir;
  const px = -dir.y;
  const py = dir.x;
  const cx = head.mouth.x - dir.x * r * 0.6;
  const cy = head.mouth.y - dir.y * r * 0.6;
  ctx.fillStyle = outline;
  ctx.beginPath();
  ctx.moveTo(head.mouth.x + dir.x * r * 0.5, head.mouth.y + dir.y * r * 0.5);
  ctx.quadraticCurveTo(
    cx + px * r * 1.3,
    cy + py * r * 1.3,
    cx - dir.x * r * 1.4,
    cy - dir.y * r * 1.4,
  );
  ctx.quadraticCurveTo(
    cx - px * r * 1.3,
    cy - py * r * 1.3,
    head.mouth.x + dir.x * r * 0.5,
    head.mouth.y + dir.y * r * 0.5,
  );
  ctx.closePath();
  ctx.fill();
}

function paintEye(
  ctx: CanvasRenderingContext2D,
  head: FishHead,
  attitude: FishAttitude,
  colors: CountershadeColors,
  lineWidth: number,
): void {
  const { eye, eyeRadius: r } = head;
  ctx.lineWidth = lineWidth;
  if (attitude.eye === 'open') {
    // socket ring, dark iris, then a bright catchlight toward the snout
    ctx.fillStyle = colors.belly;
    ctx.beginPath();
    ctx.arc(eye.x, eye.y, r * 1.15, 0, TAU);
    ctx.fill();
    ctx.fillStyle = colors.outline;
    ctx.beginPath();
    ctx.arc(eye.x, eye.y, r, 0, TAU);
    ctx.fill();
    ctx.fillStyle = colors.belly;
    ctx.beginPath();
    ctx.arc(
      eye.x + head.mouthDir.x * r * 0.34 - r * 0.12,
      eye.y + head.mouthDir.y * r * 0.34 - r * 0.3,
      r * 0.34,
      0,
      TAU,
    );
    ctx.fill();
    return;
  }
  ctx.strokeStyle = colors.outline;
  ctx.beginPath();
  if (attitude.eye === 'hollow') {
    ctx.arc(eye.x, eye.y, r * 0.9, 0, TAU);
    ctx.stroke();
  } else if (attitude.eye === 'closed') {
    ctx.arc(eye.x, eye.y - r * 0.3, r, TAU * 0.06, TAU * 0.44);
    ctx.stroke();
  } else {
    ctx.moveTo(eye.x - r * 0.8, eye.y - r * 0.8);
    ctx.lineTo(eye.x + r * 0.8, eye.y + r * 0.8);
    ctx.moveTo(eye.x + r * 0.8, eye.y - r * 0.8);
    ctx.lineTo(eye.x - r * 0.8, eye.y + r * 0.8);
    ctx.stroke();
  }
}

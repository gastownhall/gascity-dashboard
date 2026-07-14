import { describe, expect, it } from 'vitest';
import { LOD2_ZOOM } from '../contracts';
import { RIG_LABEL_ZOOM, lod2Fade, rigLabelFade } from './lod';

describe('rigLabelFade (rig map labels at the working overview)', () => {
  it('is off at the whole-tank fit floor (~0.36): the fully zoomed-out reef stays unlabeled', () => {
    expect(rigLabelFade(0.36)).toBe(0);
    expect(rigLabelFade(RIG_LABEL_ZOOM * 0.8)).toBe(0);
  });

  it('is fully in by the default home framing (~0.5), so rigs read at the working view', () => {
    expect(rigLabelFade(0.5)).toBeGreaterThan(0.9);
    expect(rigLabelFade(RIG_LABEL_ZOOM * 1.1)).toBe(1);
  });

  it('rises monotonically across its window', () => {
    expect(rigLabelFade(0.44)).toBeGreaterThan(rigLabelFade(0.41));
    expect(rigLabelFade(0.5)).toBeGreaterThan(rigLabelFade(0.44));
  });
});

describe('lod2Fade (captions + pellet ids at deep zoom only)', () => {
  it('is off well below LOD2 and positive at the threshold', () => {
    expect(lod2Fade(LOD2_ZOOM * 0.7)).toBe(0);
    expect(lod2Fade(LOD2_ZOOM)).toBeGreaterThan(0);
  });
});

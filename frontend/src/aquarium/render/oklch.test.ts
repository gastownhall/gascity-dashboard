import { describe, expect, it } from 'vitest';
import { adjustL, formatOklch, parseOklch } from './oklch';

describe('parseOklch', () => {
  it('parses canonical strings without alpha', () => {
    expect(parseOklch('oklch(88% 0.058 192)')).toEqual({ l: 88, c: 0.058, h: 192, alpha: 1 });
  });

  it('parses canonical strings with alpha', () => {
    expect(parseOklch('oklch(97% 0.05 88 / 0.36)')).toEqual({
      l: 97,
      c: 0.05,
      h: 88,
      alpha: 0.36,
    });
  });

  it('round-trips through formatOklch', () => {
    const s = 'oklch(45% 0.055 65)';
    expect(formatOklch(parseOklch(s))).toBe(s);
  });

  it('accepts bare-integer and leading/trailing-dot numeric components', () => {
    expect(parseOklch('oklch(50% 0 0)')).toEqual({ l: 50, c: 0, h: 0, alpha: 1 });
    expect(parseOklch('oklch(5.% .5 0)')).toEqual({ l: 5, c: 0.5, h: 0, alpha: 1 });
  });

  it('rejects a non-canonical string outright', () => {
    expect(() => parseOklch('rgb(1, 2, 3)')).toThrow(/not a canonical oklch/);
  });

  it.each([
    ['malformed L (two decimal points)', 'oklch(1.2.3% 0.058 192)'],
    ['malformed L (bare dot)', 'oklch(.% 0.058 192)'],
    ['malformed C (two decimal points)', 'oklch(88% 0.0.58 192)'],
    ['malformed C (bare dot)', 'oklch(88% . 192)'],
    ['malformed H (two decimal points)', 'oklch(88% 0.058 1.9.2)'],
    ['malformed H (bare dot)', 'oklch(88% 0.058 .)'],
    ['malformed alpha (two decimal points)', 'oklch(88% 0.058 192 / 0.3.6)'],
    ['malformed alpha (bare dot)', 'oklch(88% 0.058 192 / .)'],
  ])('rejects %s instead of returning NaN: %s', (_label, input) => {
    expect(() => parseOklch(input)).toThrow(/not a canonical oklch/);
  });

  it('propagates rejection through downstream helpers instead of producing NaN', () => {
    expect(() => adjustL('oklch(1.2.3% 0.058 192)', 5)).toThrow(/not a canonical oklch/);
  });
});

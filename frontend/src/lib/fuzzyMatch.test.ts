import { describe, expect, it } from 'vitest';
import { fuzzyScore } from './fuzzyMatch';

describe('fuzzyScore', () => {
  it('matches every query character in order as a subsequence', () => {
    expect(fuzzyScore('brn', 'bead review notes')).not.toBeNull();
  });

  it('rejects a query whose characters are out of order', () => {
    expect(fuzzyScore('nrb', 'bead review notes')).toBeNull();
  });

  it('rejects a query with a character absent from the target', () => {
    expect(fuzzyScore('zzz', 'bead review notes')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(fuzzyScore('BRN', 'bead review notes')).not.toBeNull();
    expect(fuzzyScore('brn', 'BEAD REVIEW NOTES')).not.toBeNull();
  });

  it('treats an empty query as a universal, weakest match', () => {
    expect(fuzzyScore('', 'anything')).toBe(0);
  });

  it('scores a consecutive-character match higher than a scattered one', () => {
    const consecutive = fuzzyScore('bead', 'bead review');
    const scattered = fuzzyScore('bead', 'b-e-a-d review');
    expect(consecutive).not.toBeNull();
    expect(scattered).not.toBeNull();
    expect(consecutive as number).toBeGreaterThan(scattered as number);
  });

  it('scores a word-start match higher than a mid-word match', () => {
    const wordStart = fuzzyScore('rev', 'bead review');
    const midWord = fuzzyScore('evi', 'bead review');
    expect(wordStart).not.toBeNull();
    expect(midWord).not.toBeNull();
    expect(wordStart as number).toBeGreaterThan(midWord as number);
  });

  it('scores a shorter target higher than a longer target with the same match quality', () => {
    const short = fuzzyScore('gcd', 'gcd-abc');
    const long = fuzzyScore('gcd', 'gcd-abc-with-a-much-longer-title-appended');
    expect(short).not.toBeNull();
    expect(long).not.toBeNull();
    expect(short as number).toBeGreaterThan(long as number);
  });
});

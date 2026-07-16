import { afterEach, describe, expect, it } from 'vitest';
import { readBodyFontFamily, readThemeTokens } from './paletteTokens';

afterEach(() => {
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-theme');
});

describe('readThemeTokens', () => {
  it('reads and trims the theme custom properties off the given root', () => {
    document.documentElement.style.setProperty('--surface', ' 96% 0.012 75 ');
    document.documentElement.style.setProperty('--fg', '18% 0.012 75');
    document.documentElement.style.setProperty('--accent', '40% 0.13 25');

    const tokens = readThemeTokens();

    expect(tokens.surface).toBe('96% 0.012 75');
    expect(tokens.fg).toBe('18% 0.012 75');
    expect(tokens.accent).toBe('40% 0.13 25');
  });

  it('passes through an empty string for a token that is not set, never a fabricated fallback', () => {
    const tokens = readThemeTokens();
    expect(tokens.warn).toBe('');
  });

  it('reads off an explicit root element rather than always the document root', () => {
    const el = document.createElement('div');
    el.style.setProperty('--fg', '5% 0 0');
    document.body.appendChild(el);

    const tokens = readThemeTokens(el);

    expect(tokens.fg).toBe('5% 0 0');
    el.remove();
  });
});

describe('readBodyFontFamily', () => {
  it('reads the computed font-family off the given element', () => {
    document.body.style.fontFamily = 'sans-serif';
    expect(readBodyFontFamily()).toBe('sans-serif');
    document.body.style.fontFamily = '';
  });
});

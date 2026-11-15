import { describe, expect, it } from 'vitest';
import { clampContrast, contrastOverrides, DEFAULT_CONTRAST, luminance, mix } from './contrast.ts';

const ratio = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};
const lightColour = { bg: '#f2f5fa', surface: '#ffffff', surface2: '#eaf0f8', ink: '#13202f' };
const darkColour = { bg: '#0c1320', surface: '#131c2b', surface2: '#1a2537', ink: '#eef3fa' };

describe('card contrast', () => {
  it('changes nothing at level 0 (the original look)', () => {
    expect(contrastOverrides(0, lightColour)).toEqual({});
  });

  it('separates cards from the page more at each level, in light and dark', () => {
    for (const base of [lightColour, darkColour]) {
      let last = ratio(base.surface, base.bg);
      for (let k = 1; k <= 5; k++) {
        const o = contrastOverrides(k, base);
        const r = ratio(o['--surface'] ?? base.surface, o['--bg'] ?? base.bg);
        expect(r).toBeGreaterThan(last);
        last = r;
      }
    }
  });

  it('adds a shadow only in light mode, and an edge in both', () => {
    expect(contrastOverrides(3, lightColour)['--cx-drop']).toMatch(/rgba/);
    expect(contrastOverrides(3, darkColour)['--cx-drop']).toBeUndefined();
    expect(contrastOverrides(3, darkColour)['--cx-edge']).toMatch(/255,255,255/);
  });

  it('uses the default level until one is chosen, and keeps levels in range', () => {
    expect(clampContrast(undefined)).toBe(DEFAULT_CONTRAST);
    expect(clampContrast(9)).toBe(5);
    expect(clampContrast(-1)).toBe(0);
    expect(mix('#000000', '#ffffff', 50)).toBe('#808080');
  });
});

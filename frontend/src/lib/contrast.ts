/**
 * Card contrast (Settings > Look, spec 11): how clearly cards stand out from the page.
 * Level 0 is the original look. Higher levels darken the page background a little in
 * light mode (in dark mode: darken the page and lighten the cards), and add a thin
 * edge and, in light mode, a soft shadow to cards. Worked out from the current
 * style and theme colours, so it suits Colour, Ink, light and dark alike.
 */

export const CONTRAST_NAMES = ['Original', 'Soft', 'Medium', 'Clear', 'Strong', 'Very strong'] as const;
export const CONTRAST_MAX = CONTRAST_NAMES.length - 1;
/** Used until the user picks a level. */
export const DEFAULT_CONTRAST = 2;

const LIGHT = {
  bg: [0, 3, 5, 7, 9, 11],
  edge: [0, 0.05, 0.07, 0.1, 0.13, 0.16],
  drop: [
    '',
    '0 1px 2px rgba(16,24,40,.04)',
    '0 1px 3px rgba(16,24,40,.06), 0 1px 2px rgba(16,24,40,.03)',
    '0 2px 6px rgba(16,24,40,.07)',
    '0 3px 10px rgba(16,24,40,.09)',
    '0 4px 14px rgba(16,24,40,.11)',
  ],
};
const DARK = { bg: [0, 15, 25, 35, 45, 55], surface: [0, 1.5, 3, 4.5, 6, 7.5], edge: [0, 0.04, 0.06, 0.08, 0.1, 0.12] };
const VARS = ['--bg', '--surface', '--surface-2', '--cx-edge', '--cx-drop'] as const;

const rgb = (hex: string): number[] => {
  const h = hex.trim().replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const toHex = (c: number[]): string => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
/** Mixes `pct` percent of colour b into colour a. */
export const mix = (a: string, b: string, pct: number): string => {
  const x = rgb(a);
  const y = rgb(b);
  return toHex(x.map((v, i) => v + (y[i]! - v) * (pct / 100)));
};
export const luminance = (hex: string): number => {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export const clampContrast = (level: number | undefined): number => Math.min(CONTRAST_MAX, Math.max(0, Math.round(level ?? DEFAULT_CONTRAST)));

/** The CSS variables to override for a level, given the theme's own colours. */
export function contrastOverrides(level: number, base: { bg: string; surface: string; surface2: string; ink: string }): Record<string, string> {
  const k = clampContrast(level);
  if (k === 0) return {};
  if (luminance(base.bg) < 0.2) {
    return {
      '--bg': mix(base.bg, '#000000', DARK.bg[k]!),
      '--surface': mix(base.surface, '#ffffff', DARK.surface[k]!),
      '--surface-2': mix(base.surface2, '#ffffff', DARK.surface[k]!),
      '--cx-edge': `rgba(255,255,255,${DARK.edge[k]})`,
    };
  }
  return {
    '--bg': mix(base.bg, base.ink, LIGHT.bg[k]!),
    '--cx-edge': `rgba(16,24,40,${LIGHT.edge[k]})`,
    '--cx-drop': LIGHT.drop[k]!,
  };
}

/** Applies a level to the page, recomputed from the current style and theme. */
export function applyContrast(level: number | undefined): void {
  const root = document.documentElement;
  for (const v of VARS) root.style.removeProperty(v);
  const cs = getComputedStyle(root);
  const get = (n: string) => cs.getPropertyValue(n).trim();
  const base = { bg: get('--bg'), surface: get('--surface'), surface2: get('--surface-2'), ink: get('--ink') };
  if (!/^#[0-9a-f]{6}$/i.test(base.bg) || !/^#[0-9a-f]{6}$/i.test(base.surface)) return;
  for (const [k, v] of Object.entries(contrastOverrides(clampContrast(level), base))) root.style.setProperty(k, v);
}

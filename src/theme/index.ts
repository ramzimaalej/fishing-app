/** Minimal design tokens. Kept framework-agnostic (plain objects). */

export const colors = {
  bg: '#0B1F2A',
  surface: '#12303D',
  surfaceAlt: '#1B4152',
  primary: '#2EC4B6',
  primaryDark: '#1B9E92',
  accent: '#FF9F1C',
  danger: '#E71D36',
  small: '#8ECae6', // small-fish highlight
  big: '#FF9F1C', // big-fish highlight
  text: '#F2F7F9',
  textMuted: '#9DB4BF',
  border: '#234A5A',
  success: '#54C46A',
} as const;

/**
 * Per-rod identity colours.
 *
 * Chosen to stay distinguishable at a glance on a dark screen in daylight, and
 * to differ in LIGHTNESS as well as hue so red-green colour blindness does not
 * collapse two rods into one. Colour is an aid, never the only signal — every
 * place a rod is coloured also shows its name.
 */
export const rodColours = {
  teal: '#2EC4B6',
  amber: '#FF9F1C',
  violet: '#B084F5',
  rose: '#F45B69',
} as const;

export type RodColour = keyof typeof rodColours;
export const ROD_COLOUR_KEYS = Object.keys(rodColours) as RodColour[];

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 20,
  pill: 999,
} as const;

export const typography = {
  h1: { fontSize: 28, fontWeight: '700' as const },
  h2: { fontSize: 22, fontWeight: '700' as const },
  h3: { fontSize: 18, fontWeight: '600' as const },
  body: { fontSize: 15, fontWeight: '400' as const },
  caption: { fontSize: 12, fontWeight: '400' as const },
} as const;

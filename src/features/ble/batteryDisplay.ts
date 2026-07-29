import { batteryState } from './battery';
import { colors } from '@/theme';

/**
 * Colour and glyph for a battery level.
 *
 * Kept next to the pure `batteryState` rather than duplicated in each screen, so
 * the Fishing rod card and the Rods list can never disagree about what "low"
 * looks like.
 */
export function batteryColor(percent: number): string {
  switch (batteryState(percent)) {
    case 'critical':
      return colors.danger;
    case 'low':
      return colors.accent;
    default:
      return colors.textMuted;
  }
}

/** 🪫 below the critical threshold, 🔋 otherwise. */
export function batteryGlyph(percent: number): string {
  return batteryState(percent) === 'critical' ? '🪫' : '🔋';
}

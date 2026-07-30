/**
 * The features the paid tier gates — pure, no imports.
 *
 * These are the premium feature set, owned by the subscription that gates them.
 *
 * Each key maps 1:1 to a real limit in config/constants.ts. A key with no limit
 * behind it is a lie on the paywall; a limit with no key is unreachable.
 */
export type PremiumFeature =
  | 'extended-forecast'
  | 'catch-insights'
  | 'session-report'
  | 'history-depth'
  | 'sound-pack'
  | 'photo-backup';

export const PREMIUM_FEATURES: readonly PremiumFeature[] = [
  'extended-forecast',
  'catch-insights',
  'session-report',
  'history-depth',
  'sound-pack',
  'photo-backup',
];

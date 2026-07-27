/**
 * In-feed ad interleaving — pure and generic, so the placement rules are
 * testable without a list, a renderer, or the SDK.
 *
 * Placement rules, in order of importance:
 *  1. Never first. A feed that opens on an ad reads as an ad-supported feed,
 *     not a feature with ads in it.
 *  2. Never last. The screen already carries an anchored banner at its foot;
 *     stacking a native unit directly above it is two ads in one viewport.
 *  3. Otherwise one unit every `interval` real rows.
 */

export type FeedEntry<T> =
  | { type: 'item'; item: T; key: string }
  | { type: 'ad'; key: string };

export interface InterleaveOptions {
  /** Real rows between ad units. Values < 1 disable interleaving. */
  interval: number;
  /** False for ad-free users — returns the items untouched. */
  enabled: boolean;
}

/**
 * Interleave ad entries into `items`. `keyOf` must return a stable unique key
 * per item; ad keys are derived from the position so they stay stable across
 * re-renders (and so React never remounts a loaded ad on an unrelated change).
 */
export function interleaveNativeAds<T>(
  items: T[],
  keyOf: (item: T, index: number) => string,
  { interval, enabled }: InterleaveOptions,
): FeedEntry<T>[] {
  const out: FeedEntry<T>[] = [];
  const insertAds = enabled && interval >= 1;

  for (let i = 0; i < items.length; i++) {
    out.push({ type: 'item', item: items[i]!, key: keyOf(items[i]!, i) });

    const boundary = (i + 1) % interval === 0;
    const isLast = i === items.length - 1;
    // Rules 1 & 2: a boundary only earns an ad when real content follows it.
    if (insertAds && boundary && !isLast) {
      out.push({ type: 'ad', key: `ad-${i + 1}` });
    }
  }

  return out;
}

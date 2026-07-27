import { interleaveNativeAds } from '../feed';

const items = (n: number): string[] => Array.from({ length: n }, (_, i) => `r${i}`);
const key = (s: string) => s;
const on = { interval: 3, enabled: true };

/** Positions of ad entries in the produced feed. */
const adIndices = (entries: { type: string }[]): number[] =>
  entries.reduce<number[]>((acc, e, i) => (e.type === 'ad' ? [...acc, i] : acc), []);

describe('interleaveNativeAds', () => {
  it('passes items straight through when disabled', () => {
    const out = interleaveNativeAds(items(10), key, { interval: 3, enabled: false });
    expect(out).toHaveLength(10);
    expect(adIndices(out)).toEqual([]);
  });

  it('never places an ad first', () => {
    const out = interleaveNativeAds(items(9), key, { interval: 1, enabled: true });
    expect(out[0]!.type).toBe('item');
  });

  it('never places an ad last', () => {
    const out = interleaveNativeAds(items(9), key, on);
    expect(out[out.length - 1]!.type).toBe('item');
  });

  it('inserts one unit every `interval` rows', () => {
    // 10 rows, interval 3 → boundaries after rows 3, 6 and 9. All three earn an
    // ad because row 10 still follows the last of them; the resulting feed is
    // r0 r1 r2 AD r3 r4 r5 AD r6 r7 r8 AD r9.
    const out = interleaveNativeAds(items(10), key, on);
    expect(adIndices(out)).toEqual([3, 7, 11]);
    expect(out.filter((e) => e.type === 'item')).toHaveLength(10);
  });

  it('drops the boundary ad when it would be trailing', () => {
    // 9 rows, interval 3 → boundaries after rows 3, 6 and 9; the last is
    // trailing, so only two ads survive.
    const out = interleaveNativeAds(items(9), key, on);
    expect(adIndices(out)).toEqual([3, 7]);
  });

  it('emits no ad when the list is shorter than the interval', () => {
    expect(adIndices(interleaveNativeAds(items(3), key, on))).toEqual([]);
    expect(adIndices(interleaveNativeAds(items(1), key, on))).toEqual([]);
  });

  it('handles an empty list', () => {
    expect(interleaveNativeAds([], key, on)).toEqual([]);
  });

  it('treats a sub-1 interval as disabled rather than dividing by it', () => {
    expect(adIndices(interleaveNativeAds(items(10), key, { interval: 0, enabled: true }))).toEqual(
      [],
    );
  });

  it('derives stable keys — same input, same keys', () => {
    const a = interleaveNativeAds(items(10), key, on).map((e) => e.key);
    const b = interleaveNativeAds(items(10), key, on).map((e) => e.key);
    expect(a).toEqual(b);
    // and every key is unique, or FlatList would drop rows
    expect(new Set(a).size).toBe(a.length);
  });

  it('carries the original item through untouched', () => {
    const out = interleaveNativeAds(items(4), key, on);
    const first = out[0]!;
    expect(first.type === 'item' && first.item).toBe('r0');
  });
});

import type { BiteEvent } from '@/types';

import { AccelRingBuffer } from '../AccelRingBuffer';

const bite = (id: string): BiteEvent => ({
  id,
  timestamp: 1,
  size: 'big',
  peakMagnitude: 2,
  confidence: 0.5,
});

describe('recording the angler verdict on a plotted bite', () => {
  it('replaces the entry rather than mutating it', () => {
    // snapshot() copies the ARRAY but not its elements, so a mutated bite would
    // change underneath a React tree that had already rendered it — the verdict
    // would be recorded and the chart would not repaint to show it.
    const buffer = new AccelRingBuffer(10);
    buffer.pushBite(bite('a'));

    const before = buffer.snapshot().bites[0]!;
    buffer.setBiteVerdict('a', 'confirmed');
    const after = buffer.snapshot().bites[0]!;

    expect(after.verdict).toBe('confirmed');
    expect(before).not.toBe(after);
    // The previously rendered object is untouched, which is what makes the
    // change visible to a memoised consumer.
    expect(before.verdict).toBeUndefined();
  });

  it('ignores a verdict for a bite it does not hold', () => {
    // Bites age out of the ring while the banner may still be showing one, and
    // a late tap must not invent an entry or throw.
    const buffer = new AccelRingBuffer(10);
    buffer.pushBite(bite('a'));

    expect(() => buffer.setBiteVerdict('gone', 'rejected')).not.toThrow();
    expect(buffer.snapshot().bites).toHaveLength(1);
    expect(buffer.snapshot().bites[0]!.verdict).toBeUndefined();
  });

  it('keeps each bite verdict to itself', () => {
    const buffer = new AccelRingBuffer(10);
    buffer.pushBite(bite('a'));
    buffer.pushBite(bite('b'));

    buffer.setBiteVerdict('b', 'rejected');

    const bites = buffer.snapshot().bites;
    expect(bites.find((x) => x.id === 'a')!.verdict).toBeUndefined();
    expect(bites.find((x) => x.id === 'b')!.verdict).toBe('rejected');
  });
});

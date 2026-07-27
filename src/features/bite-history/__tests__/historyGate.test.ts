import { FREE_HISTORY_DAYS } from '@/config/constants';
import type { BiteRecord } from '@/types';

import { applyHistoryWindow } from '../historyGate';

const NOW = new Date(2026, 5, 1, 12, 0, 0).getTime();
const DAY = 86_400_000;

function record(daysAgo: number, id = `r${daysAgo}`): BiteRecord {
  return {
    id,
    userId: 'u1',
    timestamp: NOW - daysAgo * DAY,
    size: 'small',
    peakMagnitude: 1,
    confidence: 0.5,
  };
}

// Newest first, matching biteRepository's ordering.
const records: BiteRecord[] = [
  record(0),
  record(1),
  record(FREE_HISTORY_DAYS - 1),
  record(FREE_HISTORY_DAYS + 1),
  record(FREE_HISTORY_DAYS + 90),
];

describe('applyHistoryWindow', () => {
  it('returns everything when unlocked', () => {
    const w = applyHistoryWindow(records, true, NOW);
    expect(w.visible).toBe(records); // same reference — no needless copy
    expect(w.hiddenCount).toBe(0);
    expect(w.cutoff).toBeNull();
  });

  it('withholds records older than the free window', () => {
    const w = applyHistoryWindow(records, false, NOW);
    expect(w.visible).toHaveLength(3);
    expect(w.hiddenCount).toBe(2);
    expect(w.cutoff).toBe(NOW - FREE_HISTORY_DAYS * DAY);
  });

  it('keeps a record exactly on the cutoff', () => {
    const onCutoff = record(FREE_HISTORY_DAYS, 'edge');
    const w = applyHistoryWindow([onCutoff], false, NOW);
    expect(w.visible).toHaveLength(1);
    expect(w.hiddenCount).toBe(0);
  });

  it('reports no cutoff when nothing is withheld', () => {
    const w = applyHistoryWindow([record(0), record(1)], false, NOW);
    expect(w.hiddenCount).toBe(0);
    expect(w.cutoff).toBeNull();
  });

  it('preserves the input order of visible records', () => {
    const w = applyHistoryWindow(records, false, NOW);
    expect(w.visible.map((r) => r.id)).toEqual(['r0', 'r1', `r${FREE_HISTORY_DAYS - 1}`]);
  });

  it('handles an empty history', () => {
    const w = applyHistoryWindow([], false, NOW);
    expect(w.visible).toEqual([]);
    expect(w.hiddenCount).toBe(0);
  });

  it('never mutates the input', () => {
    const input = [...records];
    applyHistoryWindow(input, false, NOW);
    expect(input).toEqual(records);
  });
});

import {
  MAX_UNTAKEN_OFFERS,
  type OfferLedger,
  pruneLedger,
  recordShown,
  recordTaken,
  shouldOffer,
  statsFor,
  SUPPRESSION_MS,
} from '../offerFatigue';

const NOW = new Date(2026, 6, 27, 12, 0, 0).getTime();

/** Present an offer n times from an empty ledger. */
function showTimes(n: number, kind: 'history-depth' = 'history-depth'): OfferLedger {
  let ledger: OfferLedger = {};
  for (let i = 0; i < n; i++) ledger = recordShown(ledger, kind, NOW);
  return ledger;
}

describe('statsFor', () => {
  it('reports a zeroed record for an unseen offer', () => {
    expect(statsFor({}, 'history-depth')).toEqual({ shown: 0, taken: 0, suppressedUntil: null });
  });
});

describe('shouldOffer', () => {
  it('allows a brand-new offer', () => {
    expect(shouldOffer({}, 'history-depth', NOW)).toBe(true);
  });

  it('keeps allowing it below the threshold', () => {
    const ledger = showTimes(MAX_UNTAKEN_OFFERS - 1);
    expect(shouldOffer(ledger, 'history-depth', NOW)).toBe(true);
  });

  it('goes quiet once ignored MAX_UNTAKEN_OFFERS times', () => {
    const ledger = showTimes(MAX_UNTAKEN_OFFERS);
    expect(shouldOffer(ledger, 'history-depth', NOW)).toBe(false);
  });

  it('stays quiet for the whole suppression period', () => {
    const ledger = showTimes(MAX_UNTAKEN_OFFERS);
    expect(shouldOffer(ledger, 'history-depth', NOW + SUPPRESSION_MS - 1)).toBe(false);
  });

  it('speaks up again once the period elapses', () => {
    const ledger = showTimes(MAX_UNTAKEN_OFFERS);
    expect(shouldOffer(ledger, 'history-depth', NOW + SUPPRESSION_MS)).toBe(true);
  });

  it('suppresses only the offer that was ignored', () => {
    const ledger = showTimes(MAX_UNTAKEN_OFFERS);
    expect(shouldOffer(ledger, 'sound-pack', NOW)).toBe(true);
  });
});

describe('recordShown', () => {
  it('counts presentations', () => {
    const ledger = showTimes(2);
    expect(statsFor(ledger, 'history-depth').shown).toBe(2);
  });

  it('resets the run when it trips suppression', () => {
    // The counter restarts so the next period is measured cleanly, rather than
    // suppressing again on the very first presentation after it lifts.
    const ledger = showTimes(MAX_UNTAKEN_OFFERS);
    const s = statsFor(ledger, 'history-depth');
    expect(s.shown).toBe(0);
    expect(s.suppressedUntil).toBe(NOW + SUPPRESSION_MS);
  });

  it('never mutates its input', () => {
    const ledger: OfferLedger = {};
    recordShown(ledger, 'history-depth', NOW);
    expect(ledger).toEqual({});
  });
});

describe('recordTaken', () => {
  it('clears suppression and the ignored run', () => {
    // Someone who engages with an offer should keep being shown it.
    const suppressed = showTimes(MAX_UNTAKEN_OFFERS);
    expect(shouldOffer(suppressed, 'history-depth', NOW)).toBe(false);

    const taken = recordTaken(suppressed, 'history-depth');
    expect(shouldOffer(taken, 'history-depth', NOW)).toBe(true);
    expect(statsFor(taken, 'history-depth')).toMatchObject({ shown: 0, taken: 1 });
  });

  it('accumulates lifetime takes', () => {
    let ledger = recordTaken({}, 'history-depth');
    ledger = recordTaken(ledger, 'history-depth');
    expect(statsFor(ledger, 'history-depth').taken).toBe(2);
  });

  it('resets the run so an engaged user is never suppressed mid-stream', () => {
    let ledger = showTimes(MAX_UNTAKEN_OFFERS - 1);
    ledger = recordTaken(ledger, 'history-depth');
    // One more presentation must not immediately trip the threshold again.
    ledger = recordShown(ledger, 'history-depth', NOW);
    expect(shouldOffer(ledger, 'history-depth', NOW)).toBe(true);
  });
});

describe('pruneLedger', () => {
  it('clears suppressions that have elapsed', () => {
    const ledger = showTimes(MAX_UNTAKEN_OFFERS);
    const pruned = pruneLedger(ledger, NOW + SUPPRESSION_MS);
    expect(statsFor(pruned, 'history-depth').suppressedUntil).toBeNull();
  });

  it('leaves live suppressions alone', () => {
    const ledger = showTimes(MAX_UNTAKEN_OFFERS);
    const pruned = pruneLedger(ledger, NOW + 1000);
    expect(statsFor(pruned, 'history-depth').suppressedUntil).toBe(NOW + SUPPRESSION_MS);
  });

  it('preserves take counts', () => {
    const ledger = recordTaken({}, 'sound-pack');
    expect(statsFor(pruneLedger(ledger, NOW), 'sound-pack').taken).toBe(1);
  });

  it('handles an empty ledger', () => {
    expect(pruneLedger({}, NOW)).toEqual({});
  });
});

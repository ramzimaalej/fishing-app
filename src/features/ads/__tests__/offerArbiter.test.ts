import { pickOffer } from '../offerArbiter';
import type { RewardKind } from '../rewards';

const all = () => ({ isUnlocked: () => false, isEligible: () => true });
const none = (kinds: RewardKind[]) => ({
  isUnlocked: (k: RewardKind) => kinds.includes(k),
  isEligible: () => true,
});
const fatigued = (kinds: RewardKind[]) => ({
  isUnlocked: () => false,
  isEligible: (k: RewardKind) => !kinds.includes(k),
});

describe('pickOffer', () => {
  it('returns at most one offer, even from many candidates', () => {
    // The whole point: screens used to render two cards side by side, which
    // converts worse than the better one alone.
    const chosen = pickOffer(['history-depth', 'photo-backup', 'sound-pack'], all());
    expect(chosen).toBe('history-depth');
  });

  it('honours the screen’s priority order', () => {
    expect(pickOffer(['photo-backup', 'history-depth'], all())).toBe('photo-backup');
  });

  it('skips anything already unlocked', () => {
    expect(pickOffer(['history-depth', 'photo-backup'], none(['history-depth']))).toBe(
      'photo-backup',
    );
  });

  it('skips anything in its fatigue quiet period', () => {
    expect(pickOffer(['history-depth', 'photo-backup'], fatigued(['history-depth']))).toBe(
      'photo-backup',
    );
  });

  it('returns null when every candidate is unlocked', () => {
    expect(pickOffer(['history-depth', 'photo-backup'], none(['history-depth', 'photo-backup']))).toBeNull();
  });

  it('returns null when every candidate is fatigued', () => {
    expect(
      pickOffer(['history-depth', 'photo-backup'], fatigued(['history-depth', 'photo-backup'])),
    ).toBeNull();
  });

  it('returns null for no candidates', () => {
    expect(pickOffer([], all())).toBeNull();
  });

  it('combines both filters', () => {
    const chosen = pickOffer(['history-depth', 'photo-backup', 'sound-pack'], {
      isUnlocked: (k) => k === 'history-depth',
      isEligible: (k) => k !== 'photo-backup',
    });
    expect(chosen).toBe('sound-pack');
  });
});

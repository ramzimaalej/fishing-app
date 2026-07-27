import {
  activeRewards,
  isRewardActive,
  pruneGrants,
  REWARD_KINDS,
  REWARDS,
  rewardExpiry,
  type RewardGrants,
} from '../rewards';

const NOW = new Date(2026, 5, 1, 9, 0, 0).getTime();
const HOUR = 3_600_000;

describe('REWARDS table', () => {
  it('has a spec for every declared kind, keyed consistently', () => {
    for (const kind of REWARD_KINDS) {
      expect(REWARDS[kind]).toBeDefined();
      // The record key and the spec's own `kind` must not drift apart — the
      // card and the grant are looked up by different one of the two.
      expect(REWARDS[kind].kind).toBe(kind);
    }
  });

  it('scopes every grant to hours or days, never permanently', () => {
    for (const kind of REWARD_KINDS) {
      const { durationMs } = REWARDS[kind];
      expect(durationMs).toBeGreaterThan(0);
      // A grant longer than a week is a subscription in all but name.
      expect(durationMs).toBeLessThanOrEqual(7 * 24 * HOUR);
    }
  });
});

describe('isRewardActive', () => {
  it('is false for a kind that was never granted', () => {
    expect(isRewardActive({}, 'sound-pack', NOW)).toBe(false);
  });

  it('is true strictly before the expiry', () => {
    const grants: RewardGrants = { 'sound-pack': NOW + 1 };
    expect(isRewardActive(grants, 'sound-pack', NOW)).toBe(true);
  });

  it('is false at and after the expiry instant', () => {
    const grants: RewardGrants = { 'sound-pack': NOW };
    expect(isRewardActive(grants, 'sound-pack', NOW)).toBe(false);
    expect(isRewardActive(grants, 'sound-pack', NOW + 1)).toBe(false);
  });

  it('does not leak one kind into another', () => {
    const grants: RewardGrants = { 'sound-pack': NOW + HOUR };
    expect(isRewardActive(grants, 'history-depth', NOW)).toBe(false);
  });
});

describe('rewardExpiry', () => {
  it('offsets now by the kind duration', () => {
    expect(rewardExpiry('photo-backup', NOW)).toBe(NOW + REWARDS['photo-backup'].durationMs);
  });
});

describe('activeRewards', () => {
  it('returns only live kinds', () => {
    const grants: RewardGrants = {
      'sound-pack': NOW + HOUR,
      'history-depth': NOW - HOUR,
      'session-report': NOW + 5 * HOUR,
    };
    expect(activeRewards(grants, NOW).sort()).toEqual(['session-report', 'sound-pack']);
  });

  it('is empty for no grants', () => {
    expect(activeRewards({}, NOW)).toEqual([]);
  });
});

describe('pruneGrants', () => {
  it('drops lapsed entries and keeps live ones intact', () => {
    const grants: RewardGrants = {
      'sound-pack': NOW + HOUR,
      'history-depth': NOW - 1,
    };
    expect(pruneGrants(grants, NOW)).toEqual({ 'sound-pack': NOW + HOUR });
  });

  it('never mutates its input', () => {
    const grants: RewardGrants = { 'history-depth': NOW - 1 };
    pruneGrants(grants, NOW);
    expect(grants).toEqual({ 'history-depth': NOW - 1 });
  });
});

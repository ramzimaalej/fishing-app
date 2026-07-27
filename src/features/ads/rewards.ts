/**
 * Rewarded-unlock registry — ZERO imports, fully unit-testable.
 *
 * Monetization doctrine (revenue side of adPolicy.ts):
 *  - Rewarded video is the only format the user *chooses*. It carries the
 *    highest eCPM of any slot and costs zero goodwill, so it should be offered
 *    wherever a genuine premium feature is within reach.
 *  - Grants are SCOPED and SHORT. A single ad must never buy a day of the whole
 *    product: that cannibalises the subscription it is supposed to sell. Each
 *    unlock covers one feature for roughly as long as the user needs it, then
 *    lapses — so the next visit re-offers the ad (or the paywall).
 *  - Every unlock maps 1:1 to a real premium gate. We never advertise an unlock
 *    for something that was free anyway.
 *
 * Adding a kind here is all that is needed to create a new rewarded surface;
 * the store, entitlements, and the unlock card are all driven off this table.
 */

/** A premium capability that a rewarded ad can temporarily unlock. */
export type RewardKind =
  | 'rod-pairing'
  | 'extended-forecast'
  | 'catch-insights'
  | 'session-report'
  | 'history-depth'
  | 'sound-pack'
  | 'photo-backup';

export interface RewardSpec {
  kind: RewardKind;
  /** Card title — names the thing the user gets, not the ad. */
  title: string;
  /** One line of "what this actually does". */
  blurb: string;
  /** Button copy. */
  cta: string;
  /**
   * How long the unlock lasts once earned. Sized to the job: long enough that
   * the user never feels cheated mid-task, short enough that it can't stand in
   * for a subscription.
   */
  durationMs: number;
  /** Human-readable duration for UI copy ("for 24 hours"). */
  durationLabel: string;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const REWARDS: Record<RewardKind, RewardSpec> = {
  /**
   * Grants a WINDOW rather than a single pairing, on purpose: an angler setting
   * up at the bank pairs three rods in one go, and charging an ad per rod would
   * be indefensible. One ad covers the whole setup.
   *
   * This gate must also fail OPEN — see useRewardedGate. A user who cannot pair
   * because AdMob had no inventory owns a bite alarm that does not work, which
   * costs far more than the impression is worth.
   */
  'rod-pairing': {
    kind: 'rod-pairing',
    title: 'Pair your sensors',
    blurb: 'Set up every rod you are fishing — one ad covers the lot.',
    cta: 'Watch ad',
    durationMs: 30 * 60_000,
    durationLabel: 'for 30 minutes',
  },
  'extended-forecast': {
    kind: 'extended-forecast',
    title: 'Unlock the full 7-day outlook',
    blurb: 'Plan the whole week — peak feeding window for every day.',
    cta: 'Watch ad',
    durationMs: DAY,
    durationLabel: 'for 24 hours',
  },
  'catch-insights': {
    kind: 'catch-insights',
    title: 'Unlock your catch insights',
    blurb: 'The barometer, temperature and tide that actually produced your bites.',
    cta: 'Watch ad',
    durationMs: DAY,
    durationLabel: 'for 24 hours',
  },
  'session-report': {
    kind: 'session-report',
    title: 'Unlock the full session report',
    blurb: 'Bite timeline, strike strength breakdown and the conditions that produced them.',
    cta: 'Watch ad',
    durationMs: 3 * HOUR,
    durationLabel: 'for 3 hours',
  },
  'history-depth': {
    kind: 'history-depth',
    title: 'See your full bite history',
    blurb: 'Open everything older than the last 30 days for a day.',
    cta: 'Watch ad',
    durationMs: DAY,
    durationLabel: 'for 24 hours',
  },
  'sound-pack': {
    kind: 'sound-pack',
    title: 'Unlock all alert sounds',
    blurb: 'Bite Bell and Sonar Ping, yours for the week.',
    cta: 'Watch ad',
    durationMs: 7 * DAY,
    durationLabel: 'for 7 days',
  },
  'photo-backup': {
    kind: 'photo-backup',
    title: 'Back up this catch to the cloud',
    blurb: 'Keep the photo safe even if you lose or change phone.',
    cta: 'Watch ad',
    durationMs: HOUR,
    durationLabel: 'for 1 hour',
  },
};

export const REWARD_KINDS: readonly RewardKind[] = Object.keys(REWARDS) as RewardKind[];

/** Expiry (epoch ms) per unlocked kind. A missing key means "never unlocked". */
export type RewardGrants = Partial<Record<RewardKind, number>>;

/** True when `kind` is currently unlocked by a rewarded grant. */
export function isRewardActive(grants: RewardGrants, kind: RewardKind, now: number): boolean {
  const until = grants[kind];
  return until !== undefined && until > now;
}

/** Expiry timestamp for a freshly earned grant. */
export function rewardExpiry(kind: RewardKind, now: number): number {
  return now + REWARDS[kind].durationMs;
}

/** Every kind still active at `now` (stable order — the REWARDS key order). */
export function activeRewards(grants: RewardGrants, now: number): RewardKind[] {
  return REWARD_KINDS.filter((k) => isRewardActive(grants, k, now));
}

/**
 * Drop lapsed entries. Purely hygiene for the persisted blob — reads always go
 * through isRewardActive, so a stale key is never *incorrect*, just noise.
 */
export function pruneGrants(grants: RewardGrants, now: number): RewardGrants {
  const next: RewardGrants = {};
  for (const k of REWARD_KINDS) {
    if (isRewardActive(grants, k, now)) next[k] = grants[k];
  }
  return next;
}

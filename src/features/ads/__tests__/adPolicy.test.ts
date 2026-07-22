import {
  AD_POLICY,
  dayKeyOf,
  evaluateSessionEndInterstitial,
  type InterstitialGateInput,
} from '../adPolicy';

const HOUR = 3_600_000;
const MINUTE = 60_000;

/** A baseline input that passes every gate. */
const T0 = new Date(2026, 5, 1, 9, 0, 0).getTime(); // local, well past any epoch edge
const PASSING: InterstitialGateInput = {
  now: T0,
  installedAt: T0 - 48 * HOUR,
  completedSessions: 3,
  sessionSeconds: 300,
  lastInterstitialAt: null,
  shownToday: 0,
  fishingActive: false,
  adFree: false,
  adLoaded: true,
};

const evaluate = (overrides: Partial<InterstitialGateInput>) =>
  evaluateSessionEndInterstitial({ ...PASSING, ...overrides });

describe('evaluateSessionEndInterstitial', () => {
  it('allows the baseline case', () => {
    expect(evaluate({})).toEqual({ allowed: true });
  });

  it('denies ad-free (premium or preview) users', () => {
    const v = evaluate({ adFree: true });
    expect(v).toMatchObject({ allowed: false, reason: expect.stringContaining('ad-free') });
  });

  it('never fires while a fishing session is active', () => {
    expect(evaluate({ fishingActive: true }).allowed).toBe(false);
  });

  it('never fires without a preloaded ad (no waiting UI)', () => {
    expect(evaluate({ adLoaded: false }).allowed).toBe(false);
  });

  it('ignores short sessions (quick fiddles are not ad opportunities)', () => {
    const min = AD_POLICY.interstitial.minSessionSeconds;
    expect(evaluate({ sessionSeconds: min - 1 }).allowed).toBe(false);
    expect(evaluate({ sessionSeconds: min }).allowed).toBe(true);
  });

  describe('new-user runway', () => {
    it('denies within the install grace window', () => {
      const grace = AD_POLICY.interstitial.installGraceHours * HOUR;
      expect(evaluate({ installedAt: T0 - grace + 1 }).allowed).toBe(false);
      expect(evaluate({ installedAt: T0 - grace }).allowed).toBe(true);
    });

    it('treats an unknown install time (0) as just-installed', () => {
      const v = evaluate({ installedAt: 0 });
      expect(v).toMatchObject({ allowed: false, reason: expect.stringContaining('grace') });
    });

    it('denies before enough completed sessions', () => {
      const min = AD_POLICY.interstitial.minCompletedSessions;
      expect(evaluate({ completedSessions: min - 1 }).allowed).toBe(false);
      expect(evaluate({ completedSessions: min }).allowed).toBe(true);
    });
  });

  describe('frequency governance', () => {
    it('enforces the cooldown between interstitials', () => {
      const cooldown = AD_POLICY.interstitial.cooldownMinutes * MINUTE;
      expect(evaluate({ lastInterstitialAt: T0 - cooldown + 1 }).allowed).toBe(false);
      expect(evaluate({ lastInterstitialAt: T0 - cooldown }).allowed).toBe(true);
    });

    it('enforces the daily cap', () => {
      const cap = AD_POLICY.interstitial.maxPerDay;
      expect(evaluate({ shownToday: cap }).allowed).toBe(false);
      expect(evaluate({ shownToday: cap - 1 }).allowed).toBe(true);
    });
  });

  it('returns a distinct reason per denial (debuggable telemetry)', () => {
    const reasons = [
      evaluate({ adFree: true }),
      evaluate({ fishingActive: true }),
      evaluate({ adLoaded: false }),
      evaluate({ sessionSeconds: 0 }),
      evaluate({ installedAt: T0 }),
      evaluate({ completedSessions: 0 }),
      evaluate({ shownToday: 99 }),
      evaluate({ lastInterstitialAt: T0 - 1 }),
    ].map((v) => (v.allowed ? '' : v.reason));
    expect(new Set(reasons).size).toBe(reasons.length);
  });
});

describe('dayKeyOf', () => {
  it('produces a stable local-day key', () => {
    const noon = new Date(2026, 6, 21, 12, 0, 0).getTime();
    expect(dayKeyOf(noon)).toBe('2026-07-21');
  });

  it('rolls over at local midnight (daily cap resets)', () => {
    const before = new Date(2026, 6, 21, 23, 59, 59).getTime();
    const after = new Date(2026, 6, 22, 0, 0, 1).getTime();
    expect(dayKeyOf(before)).not.toBe(dayKeyOf(after));
  });
});

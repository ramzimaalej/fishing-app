/**
 * Pure ad-policy engine — ZERO imports, fully unit-testable.
 *
 * Monetization doctrine for FishOn (freemium):
 *  - The moment of fishing is sacred. No ad may ever interrupt an active
 *    session; full-screen ads are only considered at the natural break when
 *    the user ends a session themselves.
 *  - Ads must never punish failure: a dropped BLE link or an app relaunch is
 *    not an ad opportunity.
 *  - New users get a quiet runway (install grace + first sessions free of
 *    interstitials) — retention first, revenue second.
 *  - Every full-screen impression is governed by cooldown + daily cap so the
 *    steady state is "occasional and expected", not "random and resented".
 *
 * All decisions flow through `evaluateSessionEndInterstitial` so the rules
 * live (and are tested) in exactly one place.
 */

export interface InterstitialPolicy {
  /** No interstitials within this many hours of first launch. */
  installGraceHours: number;
  /**
   * Minimum lifetime *completed* fishing sessions before the first
   * interstitial. NOTE: the session that just ended is already counted, so a
   * value of 3 means "the user's first two sessions are guaranteed ad-free".
   */
  minCompletedSessions: number;
  /** Sessions shorter than this never count nor trigger ads (quick fiddles). */
  minSessionSeconds: number;
  /** Minimum minutes between two interstitials. */
  cooldownMinutes: number;
  /** Hard daily ceiling on interstitials. */
  maxPerDay: number;
}

export interface PreviewPolicy {
  /** How long a rewarded-ad "Premium Preview" lasts. */
  durationHours: number;
}

export const AD_POLICY: { interstitial: InterstitialPolicy; preview: PreviewPolicy } = {
  interstitial: {
    installGraceHours: 24,
    minCompletedSessions: 3,
    minSessionSeconds: 120,
    cooldownMinutes: 15,
    maxPerDay: 4,
  },
  preview: {
    durationHours: 24,
  },
};

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

export interface InterstitialGateInput {
  /** Current epoch ms. */
  now: number;
  /** Epoch ms of first launch; 0 = unknown (treated as "just installed"). */
  installedAt: number;
  /** Lifetime completed (≥ minSessionSeconds) fishing sessions, incl. the one just ended. */
  completedSessions: number;
  /** Duration of the session that just ended, in seconds. */
  sessionSeconds: number;
  /** Epoch ms of the last interstitial shown, or null if never. */
  lastInterstitialAt: number | null;
  /** Interstitials already shown today (local day). */
  shownToday: number;
  /** True while a fishing session is active (belt & braces — never show then). */
  fishingActive: boolean;
  /** True when the user is entitled to an ad-free experience (premium/preview). */
  adFree: boolean;
  /** True when an interstitial is actually preloaded (never block UI waiting). */
  adLoaded: boolean;
}

export type GateVerdict = { allowed: true } | { allowed: false; reason: string };

const deny = (reason: string): GateVerdict => ({ allowed: false, reason });

/** Single gate deciding whether the session-end interstitial may be shown. */
export function evaluateSessionEndInterstitial(
  input: InterstitialGateInput,
  policy: InterstitialPolicy = AD_POLICY.interstitial,
): GateVerdict {
  if (input.adFree) return deny('ad-free entitlement');
  if (input.fishingActive) return deny('fishing session active');
  if (!input.adLoaded) return deny('no ad preloaded');
  if (input.sessionSeconds < policy.minSessionSeconds) return deny('session too short');

  const installedAt = input.installedAt > 0 ? input.installedAt : input.now;
  if (input.now - installedAt < policy.installGraceHours * HOUR_MS) {
    return deny('install grace period');
  }
  if (input.completedSessions < policy.minCompletedSessions) {
    return deny('new-user session grace');
  }
  if (input.shownToday >= policy.maxPerDay) return deny('daily cap reached');
  if (
    input.lastInterstitialAt !== null &&
    input.now - input.lastInterstitialAt < policy.cooldownMinutes * MINUTE_MS
  ) {
    return deny('cooldown');
  }
  return { allowed: true };
}

/** Local-calendar day key (used to reset the daily counter at local midnight). */
export function dayKeyOf(now: number): string {
  const d = new Date(now);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

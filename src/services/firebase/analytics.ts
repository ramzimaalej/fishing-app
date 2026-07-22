import { getApp } from '@react-native-firebase/app';
import {
  getAnalytics,
  logEvent,
  logLogin,
  logPurchase,
  logScreenView,
  logSignUp,
  setAnalyticsCollectionEnabled,
  setUserId,
  type FirebaseAnalyticsTypes,
} from '@react-native-firebase/analytics';

import type { BiteSize } from '@/types';

/**
 * Firebase Analytics wrapper.
 *
 * Every call is fire-and-forget and fully guarded: analytics must NEVER break
 * the app, so a missing native module (Expo Go, tests) or a transient failure
 * is swallowed. Uses the modular RNFirebase API to match the rest of the
 * service layer.
 *
 * IDFA note: this uses the standard Analytics SDK (AdId-capable). That is
 * consistent with the app already shipping AdMob (which uses the IDFA under ATT
 * consent). If AdMob is ever removed and you want zero IDFA collection, switch
 * to the no-AdId Analytics pod via the Podfile flag
 * `$RNFirebaseAnalyticsWithoutAdIdSupport = true` (a prebuild config-plugin
 * tweak) — see README.
 */

type Analytics = FirebaseAnalyticsTypes.Module;

async function run(fn: (a: Analytics) => Promise<unknown>): Promise<void> {
  try {
    await fn(getAnalytics(getApp()));
  } catch {
    /* analytics is best-effort — never surface to the user */
  }
}

/** Attribute subsequent events to a user (or clear on sign-out). */
export function setAnalyticsUser(uid: string | null): void {
  void run((a) => setUserId(a, uid));
}

/** Toggle collection (e.g. from a future privacy setting). */
export function setAnalyticsEnabled(enabled: boolean): void {
  void run((a) => setAnalyticsCollectionEnabled(a, enabled));
}

/** GA4 screen_view — wired to navigation in App.tsx. */
export function trackScreen(screen: string): void {
  void run((a) => logScreenView(a, { screen_name: screen, screen_class: screen }));
}

export function trackLogin(method: string): void {
  void run((a) => logLogin(a, { method }));
}

export function trackSignUp(method: string): void {
  void run((a) => logSignUp(a, { method }));
}

/** Signature engagement event for the app: a detected bite. */
export function trackBite(size: BiteSize, confidence: number): void {
  void run((a) =>
    logEvent(a, 'bite_detected', { size, confidence: Math.round(confidence * 100) }),
  );
}

/** Conversion event: a completed premium purchase. */
export function trackPurchase(productId: string, value?: number, currency = 'USD'): void {
  void run((a) =>
    logPurchase(a, {
      currency,
      value: value ?? 0,
      items: [{ item_id: productId, item_name: productId }],
    }),
  );
}

/** Generic escape hatch for ad-hoc events. */
export function trackEvent(name: string, params?: Record<string, unknown>): void {
  void run((a) => logEvent(a, name, params));
}

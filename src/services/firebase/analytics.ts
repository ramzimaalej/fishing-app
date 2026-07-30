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
 * ⚠️ IDFA — ACTION AVAILABLE NOW THAT ADMOB IS GONE.
 *
 * This still pulls the standard Analytics SDK, which is AdId-capable. That was
 * the right call while AdMob shipped (it used the IDFA under ATT consent), but
 * the app no longer serves ads, so the IDFA buys nothing and its presence still
 * forces an App Privacy "tracking" declaration and an ATT prompt on iOS.
 *
 * Switching to the no-AdId pod removes both:
 *   $RNFirebaseAnalyticsWithoutAdIdSupport = true
 * set in the Podfile via a prebuild config plugin. See README.
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

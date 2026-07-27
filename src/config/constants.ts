import type { AppSettings } from '@/types';

/** Default user settings applied on first launch. */
export const DEFAULT_SETTINGS: AppSettings = {
  liveBaitMode: false,
  sensitivity: 0.5,
  vibrationEnabled: true,
  soundEnabled: true,
  soundKey: 'classic-reel',
  pushEnabled: true,
};

/** Selectable notification sounds. `asset` resolved via require() in the player. */
export const NOTIFICATION_SOUNDS: readonly { key: string; label: string }[] = [
  { key: 'classic-reel', label: 'Classic Reel Click' },
  { key: 'splash', label: 'Splash' },
  { key: 'bell', label: 'Bite Bell' },
  { key: 'sonar', label: 'Sonar Ping' },
];

/**
 * Free-tier limits. Each one is the gate behind a rewarded unlock in
 * features/ads/rewards.ts — a limit with no unlock path is just an annoyance,
 * and an unlock with no limit is a lie, so these two tables move together.
 */
/** Days of the multi-day outlook shown without premium or a rewarded unlock. */
export const FREE_FORECAST_DAYS = 3;
/** How far back bite history is readable on the free tier. */
export const FREE_HISTORY_DAYS = 30;
/** Alert sounds available free — the first N entries of NOTIFICATION_SOUNDS. */
export const FREE_SOUND_COUNT = 2;

/**
 * Premium product identifiers (App Store / Play Console).
 *
 * TWO ways to buy the same entitlement:
 *  - `lifetime` — one payment, owned forever;
 *  - `yearly`   — auto-renewing subscription.
 *
 * Offering both is deliberate. Castmate usage is strongly seasonal, so a
 * recurring plan bleeds subscribers every autumn; a one-off purchase also
 * matches the mental model of someone who just bought a bite alarm. But
 * recurring revenue is worth several times more at valuation, so rather than
 * guess the split we offer both and let real behaviour decide. There is no
 * monthly plan — it would churn hardest of all.
 *
 * PRICING IS NOT SET HERE. Per-country prices live in App Store Connect and the
 * Play Console; the app only ever displays the `localizedPrice` the store
 * returns. Hardcoding a price would desync from what the user is actually
 * charged (and Apple rejects builds that display a mismatched price). Intended
 * configuration: lifetime $39.99 / 39.99 TND, yearly $19.99 / 19.99 TND.
 *
 * Prices reflect what Premium actually gates — features with real marginal cost
 * to us (weather API calls, cloud storage) plus ad removal. They are not priced
 * as though the app were the whole product: the sensor is.
 */
export const IAP_PRODUCT_IDS = {
  lifetime: 'co.castmate.premium.lifetime',
  yearly: 'co.castmate.premium.yearly',
} as const;

export type PlanKey = keyof typeof IAP_PRODUCT_IDS;

/**
 * Store product TYPE per plan. This decides which react-native-iap call is used
 * (`requestPurchase` vs `requestSubscription`) and which catalogue lookup
 * (`getProducts` vs `getSubscriptions`) — mixing them up fails at runtime with
 * an empty product list, so the mapping is explicit rather than inferred from
 * the id.
 *
 * In the stores these are genuinely different products: a **Non-Consumable** IAP
 * on iOS / **one-time product** on Play for lifetime, and an Auto-Renewable
 * Subscription for yearly. One type cannot be converted into the other.
 */
export const PLAN_KIND: Record<PlanKey, 'oneTime' | 'subscription'> = {
  lifetime: 'oneTime',
  yearly: 'subscription',
};

/** Display order on the paywall — lifetime first, as the recommended option. */
export const PLAN_ORDER: readonly PlanKey[] = ['lifetime', 'yearly'];

/**
 * Free-tier fishing-session limits.
 *
 * A free account monitors for FREE_SESSION_HOURS at a stretch, and gets
 * FREE_SESSIONS_PER_DAY such blocks per local day for nothing; continuing beyond
 * that costs one rewarded ad per block. Premium has no limit at all.
 *
 * The per-day allowance is what makes the cap real: without it a user could end
 * an expired session and immediately start another for free, and the extension
 * ad would never be worth watching.
 */
export const FREE_SESSION_HOURS = 6;
export const SESSION_EXTENSION_HOURS = 6;
export const FREE_SESSIONS_PER_DAY = 1;
/**
 * How long before expiry the user is warned. They are usually asleep or away
 * from the phone, so the warning has to arrive early enough to act on — a cap
 * that lapses silently means rods nobody is watching.
 */
export const SESSION_EXPIRY_WARNING_MINUTES = 15;

/**
 * Practical ceiling on simultaneously monitored rods — NOT a paid limit (see
 * features/rods/rod.ts for why rod count isn't gated). 3–4 rods is standard
 * practice, and often the legal limit, for the static-line fishing this app
 * serves; concurrent BLE links are finite too — iOS tolerates roughly a dozen,
 * Android considerably fewer on some chipsets.
 */
export const MAX_RODS = 4;

/** Firestore collection names. */
export const COLLECTIONS = {
  users: 'users',
  bites: 'bites',
} as const;

/** How many acceleration samples the live graph keeps in its rolling window. */
export const GRAPH_WINDOW_SIZE = 300;

/**
 * Sensor sample rate (Hz) used for filter-window sizing and the mock's cadence.
 *
 * The Minew E8S is a broadcast beacon whose effective rate is its advertising
 * interval (motion-triggered). ~10 Hz assumes the tag is configured to its
 * fastest interval (~100 ms) in Minew BeaconSET+ — the recommended fishing
 * setup. Detection windows are expressed in seconds, so they scale correctly if
 * this changes; but note a coin-cell beacon cannot match a wired 50 Hz IMU, so
 * bite waveforms are coarser than a dedicated sensor would provide.
 */
export const SENSOR_SAMPLE_RATE_HZ = 10;

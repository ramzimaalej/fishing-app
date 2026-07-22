# 🎣 FishOn

A React Native (Expo) app for fishing enthusiasts: real-time **fish-bite
detection** from a Bluetooth accelerometer, live **environmental insights**
(pressure, wind, waves, tide, moon, fish-activity prediction), bite history with
photos, subscriptions, and ads for free users.

> **Framework:** Expo (config plugins + custom dev client). All native modules
> below require a **prebuild / dev client** — the app does **not** run in Expo Go.

---

## Architecture

```
index.ts → App.tsx → NavigationContainer → RootNavigator
                                              ├─ Auth stack   (SignIn / SignUp / VerifyEmail)
                                              └─ Main tabs     (Fishing / Conditions / History / Settings)
                                                                 + Paywall (modal)

src/
├─ config/            constants + default settings
├─ types/             shared domain types (single source of truth)
├─ theme/             design tokens (dark theme)
├─ services/firebase/ auth · firestore · storage · messaging (modular RNFirebase API)
└─ features/
   ├─ auth/           email + Google/Apple/Facebook, email-verification gate
   ├─ subscription/   react-native-iap store + paywall (premium removes ads)
   ├─ environment/    Open-Meteo provider, moon phase, fish-activity model, screen
   ├─ ble/            GATT protocol + codec, real client (auto-reconnect), mock, store
   ├─ bite-detection/ Kalman + moving-average filters, detector, live pipeline hook
   ├─ graph/          real-time SVG acceleration chart + rolling buffer
   ├─ bite-history/   Firestore repo, live list, image attach
   ├─ notifications/  haptics + sound + local push feedback
   ├─ ads/            policy-governed AdMob: banners, session-end interstitial,
   │                  rewarded Premium Preview (see “Monetization” below)
   ├─ settings/       persisted settings (AsyncStorage) + screen
   └─ fishing/        main live-detection screen (always ad-free)
```

State is **zustand**; persistence is **Firestore** (data) + **AsyncStorage**
(settings & premium cache). Data providers sit behind interfaces
(`EnvironmentProvider`, `SensorConnection`) so the weather source or the BLE
transport can be swapped without touching the UI.

---

## The bite-detection engine

Pure, dependency-free TypeScript (`src/features/bite-detection`), so it is fully
unit-tested and portable. Per accelerometer sample:

1. **magnitude** `= √(x²+y²+z²)`
2. **baseline** — EMA low-pass (gravity + slow line tension). Live-bait mode
   tracks it ~2× faster to subtract steady bait wiggle.
3. **dynamic** `= Kalman(|magnitude − baseline|)` — a clean strike signal.
4. **adaptive threshold** `T = max(floor, μ_noise + k·σ_noise)`, where the noise
   floor is learned **only while not mid-bite** and `k` comes from the
   sensitivity slider (higher sensitivity → lower `k` → smaller bites detected).
5. A **rising/falling-edge state machine** over `T` (with hysteresis + a
   refractory period) detects a bite, tracks its peak, assigns a **confidence**,
   and **classifies small vs big** against a physical boundary that rises with
   the noise floor.

Validated behaviours (see tests): quiet → no bites; big strike → `big`; nibble →
`small`; constant bait motion → no false bites (both modes); lower sensitivity →
higher threshold; strikes inside the refractory window collapse to one.

### BLE GATT profile (custom)

```
Service  a5c10000-0000-1000-8000-00805f9b34fb   FishOn Sensor
  Char   a5c10001-…   Accelerometer stream   NOTIFY
  Char   a5c10002-…   Control                WRITE   (set sample-rate / fishing mode)
```

Accelerometer packets are little-endian: `uint8 count` then `count × (uint32 t,
int16 x, int16 y, int16 z)` in **milli-g**. A firmware can target this 1:1; the
in-app **`MockSensor`** implements it so the whole pipeline runs with no
hardware (toggle *Use simulator* on the Fishing screen). Real connections
auto-reconnect with exponential backoff (`BleSensorClient`).

---

## Monetization (freemium)

**Doctrine: the moment of fishing is sacred — monetize planning and reviewing,
never catching.** All rules live in one pure, unit-tested gate
(`features/ads/adPolicy.ts`); screens contain zero ad logic beyond placement.

| Surface | Treatment |
| --- | --- |
| Fishing (live) | **No ads, ever** — the core surface stays clean; that cleanliness is the premium pitch |
| Conditions / History | Anchored adaptive banner (passive planning/review contexts) |
| Session end (user taps *Disconnect*) | ≤ 1 interstitial, policy-gated; dropped connections never trigger ads |
| Conditions card + Paywall | **Rewarded ad → 24h “Premium Preview”** (ad-free + pro perks) |
| App open | Deliberately none — anglers open the app when a fish is on |

Interstitial governance: none in the first 24 h after install, none before the
3rd meaningful (≥ 2 min) session, 15-min cooldown, hard cap 4/day, never while
a session is active, and only when an ad is already preloaded. Caps persist
across restarts (`adsStore`, AsyncStorage).

Revenue logic: rewarded video carries ~10–20× banner eCPM and is the only
format users opt into; the 24 h preview it grants doubles as the upgrade
funnel. Entitlements (`useEntitlements`) decouple *ad-free* from *pro* so ads,
feature gates, and future tiers stay independent. UMP consent (GDPR + ATT) is
gathered lazily on the first ad surface — premium users never see a consent
prompt; without consent, requests are non-personalized.

---

## Setup

1. **Install**
   ```bash
   npm install
   ```
2. **Firebase** — create a project, enable Email/Password + Google/Apple/Facebook
   auth, Firestore, and Storage. Download and place at the repo root:
   - `google-services.json` (Android)
   - `GoogleService-Info.plist` (iOS)

   Both are git-ignored. Deploy the included rules:
   ```bash
   firebase deploy --only firestore:rules,storage
   ```
3. **Env** — `cp .env.example .env` and fill in Google/Facebook/AdMob IDs.
   (AdMob falls back to Google's public **test** IDs so ads work immediately.)
4. **Prebuild & run** (requires Xcode / Android Studio):
   ```bash
   npm run prebuild
   npm run ios      # or: npm run android
   ```

---

## Testing

```bash
npm test          # jest unit tests (filters, detector, BLE codec, moon, fish activity)
npm run typecheck # tsc --noEmit
npm run lint
```

The detection engine, BLE packet codec, moon-phase and fish-activity models are
covered by deterministic unit tests (no device or network needed).

---

## Requirements → where it lives

| Requirement | Implementation |
| --- | --- |
| Email sign-up + confirmation gate | `features/auth`, `services/firebase/auth.ts`, `RootNavigator` gates on `emailVerified` |
| Social login (Google / Apple / Facebook) | `services/firebase/auth.ts`, `SignInScreen` |
| Subscription removes ads / unlocks | `features/subscription/useEntitlements` — single gate read by every ad surface |
| Environmental data through the day | `features/environment` (Open-Meteo, hourly forecast + best window) |
| BLE + auto-reconnect | `features/ble` (`BleSensorClient`, backoff schedule) |
| Bite detection (Kalman + MA), small/big | `features/bite-detection` |
| Live bait mode / sensitivity | `settingsStore` → `BiteDetector.setConfig` + device control write |
| Feedback: vibration / sound / push | `features/notifications/feedback.ts` |
| Graph + highlighted bites | `features/graph/AccelerationChart` |
| Bite history + optional image | `features/bite-history` (Firestore + Storage) |
| Settings persist across restarts | `settingsStore` (zustand `persist` + AsyncStorage) |
| Ads for non-premium | `features/ads` (policy-gated; see “Monetization”) |

## Follow-ups (noted, not blocking)

- Real device geolocation (`expo-location`) to replace `DEFAULT_COORDS`.
- Bundle notification sound assets (`assets/sounds/`) and register them.
- Server-side IAP receipt validation before granting entitlements.
- Facebook app configuration (App ID / client token) in `.env`.
- Create real AdMob ad units (6 ids in `.env`) and configure the UMP consent
  form + ATT message in the AdMob console (dev builds use Google test ids).

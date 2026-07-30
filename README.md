# 🎣 Castmate

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
                                                                 + Rods · Pair sensor (from Fishing)
                                                                 + Paywall · Session report (modals)
                                                                 + Best times (from Conditions)
                                                                 + Catch insights (from History)

src/
├─ config/            constants + default settings
├─ types/             shared domain types (single source of truth)
├─ theme/             design tokens (dark theme)
├─ utils/             small shared helpers (local day key)
├─ i18n/              en/fr/es locales, language resolution, locale formatting
├─ services/firebase/ auth · firestore · storage · messaging · analytics (modular RNFirebase API)
└─ features/
   ├─ auth/           email + Google sign-in, email-verification gate
   ├─ subscription/   react-native-iap store + paywall (premium removes ads)
   ├─ environment/    Open-Meteo provider (multi-day), moon phase, hourly
   │                  fish-activity model, solunar month model, screens
   ├─ rods/           rod model, per-rod runtime, rod + pairing screens
   ├─ session/        free-tier session window: limits, expiry, extensions
   ├─ ble/            shared scan broker, GATT + broadcast clients, mock, registry
   ├─ bite-detection/ Kalman + moving-average filters, detector (one per rod)
   ├─ graph/          real-time SVG acceleration chart + per-rod ring buffer
   ├─ bite-history/   Firestore repo, live list, image attach
   ├─ notifications/  haptics + sound + local push feedback
   ├─ session-report/ post-session debrief (pure summary model + screen)
   ├─ insights/       ERA5 retrospective catch analysis (lift model + screen)
   ├─ settings/       persisted settings (AsyncStorage) + screen
   └─ fishing/        main live-detection screen
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

### Sensor: Minew E8S Asset Tag (BLE broadcast)

The hardware is a **Minew E8S** (Nordic nRF52 + LIS3DH accelerometer, CR2032).
It is a **broadcast beacon**, not a connectable peripheral — it advertises its
accelerometer reading in the Minew *Acc Sensor* frame, and the app **scans** for
it (`E8sSensorClient`), parsing one `AccelSample` per advertisement.

```
Advertising service data — UUID 0xFFE1 (Minew), 15 bytes, big-endian:
  byte 0     0xA1                 frame type (Acc Sensor)
  byte 1     product model
  byte 2     battery %
  bytes 3-4  X   int16 signed 8.8 fixed-point  (/256 = g)
  bytes 5-6  Y
  bytes 7-8  Z
  bytes 9-14 MAC address
```

Decoding is verified against a real capture (`minew.ts`, `minew.test.ts`). The
in-app **`MockSensor`** emits through the *same* codec so the whole pipeline
runs with no hardware (pick *Simulator* as a rod's sensor on the Rods screen). Because
there is no connection, "auto-reconnect" means the scan is continuous and
resilient to gaps: if the tag goes quiet the UI shows *reconnecting* and
resumes seamlessly when advertisements return.

**Configuration & fidelity.** Motion sensitivity and advertising interval are
set on the tag itself via Minew's **BeaconSET+** app (not over BLE from this
app), so `setFishingMode`/`setSampleRate` are no-ops for the E8S. For fishing,
configure the tag to its **fastest advertising interval (~100 ms) with motion
trigger** — but note a coin-cell beacon broadcasting at ~1–10 Hz yields
**coarser** bite waveforms than a wired 50 Hz IMU. It reliably flags a strike's
magnitude spike; it is not a high-rate waveform recorder. `SENSOR_SAMPLE_RATE_HZ`
reflects this (~10 Hz); detection windows are in seconds, so they scale if you
reconfigure the tag.

---

## Multiple rods

`features/rods` monitors several rods **simultaneously** — each with its own
sensor, its own `BiteDetector`, and its own named alarm, so an alert says *which*
rod to pick up. Every user gets up to `MAX_RODS` (4), free.

### Why rod count is NOT a paid feature

It was, briefly, and that was a mistake worth recording. An angler fishing three
rods needs three *sensors*, and sensors are the high-margin product (~$8 landed,
and packaging/shipping is shared across a multi-sensor order). Gating rod count
therefore puts a paywall between the customer and hardware they have already
bought from us — throttling the exact upsell it was supposed to monetise, and
charging rent on a device they own.

It also fails the test that decides everything else on the paywall: **Premium
gates things with real marginal cost to us** (weather API calls, cloud storage)
plus ad removal. Rod count costs us nothing per user. `MAX_RODS` is a practical
ceiling — 3–4 rods is standard, often legal-limit, practice for static-line
fishing, and concurrent BLE links are finite — never a commercial one.

### Why the runtime isn't a hook

Every armed rod must keep detecting whether or not its chart is on screen. A
hook is per-component, which would tie a rod's pipeline to its visibility — and
a bite alarm that silently watches only the selected rod is worse than none,
because the user believes it is watching all of them. So `rodRuntime.ts` owns the
pipelines outside React and publishes a coalesced snapshot (`FLUSH_MS`) that
components subscribe to. `AccelRingBuffer` exists for the same reason: one
buffer per rod, no hook.

The cross-rod session bite log also lives in the runtime. The screen could not
reconstruct it from the graph buffers — those are rolling windows, so any bite
that scrolled out between polls would vanish from the report.

### Two BLE constraints that shaped this

1. **`react-native-ble-plx` has exactly one global scan.** Before multi-rod a
   single client owned it outright. Concurrently, a second `startDeviceScan`
   either errors or replaces the first client's callback, and the first client to
   disarm would call `stopDeviceScan()` and deafen every rod still fishing. So
   nobody touches the scan directly any more: `scanBroker.ts` refcounts one
   shared scan and fans advertisements out to all subscribers, each filtering for
   its own device. Both `MinewSensorClient` and `GattSensorClient` go through it.
   (Consequence: `scanServiceUUIDs` is now applied client-side rather than as a
   platform filter — same outcome, a few more advertisements inspected.)

2. **Sensors must be bound per rod.** An unbound broadcast client locks onto the
   first tag it hears, so two unbound rods would latch the *same* tag and report
   one physical sensor as two rods. `Rod.deviceId` is therefore mandatory for
   every real sensor (`requiresDeviceBinding`), `armRod()` refuses an unbound
   rod rather than misleading the user, and `PairSensorScreen` exists to make
   that binding — warning when a tag is already claimed by another rod.

### History is immutable

Rod names on bite records are denormalised (`BiteRecord.rodName`) so renaming or
deleting a rod never rewrites history — a bite is a historical fact.

---

## Catch insights (ERA5 retrospective analysis)

`features/insights` answers *which conditions actually produced your bites*, by
matching bite history against **ERA5 reanalysis** from Open-Meteo's archive API.
Reanalysis, not forecast: it has been corrected against observations after the
fact, which is what makes it the right source for looking backwards.

**Why raw bite counts are useless here.** "You caught 40% of your fish on a
falling barometer" means nothing until you know how often the barometer was
falling. So each bucket is scored by **lift**:

```
lift = (share of bites in bucket) / (share of background hours in bucket)
```

The background distribution comes from the *same* hourly series the bites are
matched against, so both shares are measured over identical ground. `lift > 1`
means over-represented among catches relative to how often the condition
occurred; `1.0` is exactly chance.

Guards against telling users comfortable nonsense:

- `MIN_SAMPLE` (12) matched bites before anything is shown at all.
- `MIN_BUCKET_BITES` (3) before a bucket may be named "best" — otherwise one
  lucky cast in a rare condition reports enormous lift.
- A bucket needs `lift > 1` to be recommended at all.
- Dimensions with fewer than two occupied buckets are dropped (a one-bucket
  scale conveys nothing), as are buckets that never occurred.
- An unknown `pressureTrend` is **excluded**, never counted as "steady" —
  `EnvironmentSnapshot.pressureTrend` is optional precisely so snapshots
  persisted before the field existed don't skew the analysis.

**Stated limitation** (in the UI, not just here): lift corrects for how common
a condition was, but *not* for when the angler chose to fish. Someone who only
fishes at dawn will see dawn lead regardless of the fish. Fixing that needs
per-session effort logging (hours fished per bucket), which bite records don't
carry yet.

**Windowing** (`historyWindow.ts`): one contiguous archive request covering the
narrower of "since your first bite" and `INSIGHTS_WINDOW_DAYS` (180), ending
`ERA5_LAG_DAYS` (5) before today — reanalysis inside that tail is a mix of ERA5T
and model estimates, so it is excluded rather than blended into the statistics.
Bites too recent to analyse are surfaced as a count, not silently dropped.
Verified: a 180-day request returns ~4,300 hours in ~173 KB, cached per
(coords, window).

> **Licensing:** Open-Meteo's free tier is **non-commercial only** — apps with
> ads or subscriptions require a paid plan or self-hosting (it is AGPL open
> source). This applies to the whole `environment` feature, not just the
> archive. Resolve before shipping.

---

## Fishing sessions (free-tier time limit — inactive by default)

Monitoring runs inside a **session window** (`features/session`).

> **Inactive on the shipping build.** With `SUBSCRIPTIONS_ENABLED` false everyone
> is `pro`, so `expiresAt` is null and sessions never lapse. The machinery below
> only applies if a paid tier is switched on.

With a paid tier enabled, free accounts fish in `FREE_SESSION_HOURS` (6) blocks;
premium has no limit (`expiresAt: null`).

| | Free | Premium |
| --- | --- | --- |
| Session length | 6 h blocks | unlimited |
| First block each local day | free | — |
| Further blocks | subscribe | — |
| Pairing a sensor | free | free |

### Why the daily allowance exists

Without it the cap is decorative: a user whose window lapsed could simply stop
and start again for another free six hours. So the opening session **and every
extension** count against `FREE_SESSIONS_PER_DAY` — both buy the same amount of
fishing, so neither can be laundered into the other.

### Enforcement is load-bearing, so lapses must never be silent

When a window lapses the runtime disarms every rod. That is the whole point, and
also the danger: an angler asleep beside three rods must not discover at dawn
that nothing was being watched. Three consequences:

- **Expiry is wall-clock, not a timer.** A six-hour `setTimeout` does not survive
  the app being suspended, so `useSessionExpiryEnforcement` polls and re-checks
  on every return to foreground.
- **The warning is an OS-scheduled notification**
  (`scheduleSessionNotifications`), fired `SESSION_EXPIRY_WARNING_MINUTES` (15)
  before expiry, precisely because the app may not be running at the moment it
  matters. A second notification confirms the lapse.
- **The lapsed window is not cleared.** It stays in an expired state so the UI
  can say "session ended" and offer the extension. Clearing it would make the
  lapse invisible — the one outcome this feature exists to prevent.

---

## Languages

English, French and Spanish (`src/i18n`), on **i18next + react-i18next +
expo-localization**. English is the base and the fallback.

i18next rather than a lookup table because of **plural rules**: English has two
forms, but CLDR gives French and Spanish `one/many/other`, and a hand-rolled
`count === 1 ? a : b` is wrong in both. Plurals go through `Intl.PluralRules`, so
call sites never encode an English assumption.

### A missing translation is a compile error

`en.ts` is declared `as const`, and `Translation` (in `locales/types.ts`) widens
its literals to `string`. Every other locale must satisfy that type — so a
missing or misspelled key fails the build instead of rendering as its own dotted
key in front of a user.

`__tests__/locales.test.ts` catches what types cannot:

- every locale uses the **same `{{placeholders}}`** as English — a dropped
  `{{count}}` renders a sentence with a hole in it and never throws;
- every plural key carries `{{count}}`, since i18next only selects a plural form
  when `count` is passed;
- the files are not simply copies of English.

### Formatting is localised too

The half that gets forgotten and then looks broken. Two systems, both fed the
locale from `i18n/formatting.ts`: `date-fns` `format()` takes a locale **object**,
`Intl` / `toLocaleDateString` take a locale **tag**. A French user sees
"mer. 30" and "1,5", not "Wed 30" and "1.5".

### Two decisions worth keeping

**Angling vocabulary, not literal translation.** A bite is a *touche* in French
and a *picada* in Spanish; live-bait mode is *mode vif* / *cebo vivo*. An angler
reading "morsure" would know instantly that nobody who fishes wrote it.

**Rod names are localised once, at creation.** `rod.ts` stays pure and
i18n-free; `rodStore` produces the localised default when a rod is created.
Translating at render time would rename the user's rods out from under them on a
language switch — the name is persisted and user-editable.

> ⚠️ **`paywall.legal`, `paywall.planNote` and `paywall.cancelWarning` need a
> native-speaker review** in both fr.ts and es.ts before release. They state
> subscription terms; a mistranslated auto-renewal disclosure is an App Store
> rejection and a consumer-law problem. Both files carry the warning in-header.

---

## Pricing

**Two ways to buy the same entitlement:** a one-off **lifetime** unlock and a
**yearly** subscription. No monthly plan — usage is strongly seasonal, so any
short recurring plan churns hardest of all.

Offering both is deliberate rather than indecisive. A one-off purchase matches
the mental model of someone who just bought a bite alarm and removes the
end-of-season churn cliff entirely; recurring revenue is worth several times more
at valuation. Rather than guess the split, both are offered and real behaviour
decides.

They are different **store product types**, not just different prices — a
Non-Consumable IAP / Play one-time product versus an Auto-Renewable
Subscription. `PLAN_KIND` in `config/constants.ts` maps each plan to its type,
which drives `getProducts` vs `getSubscriptions` and `requestPurchase` vs
`requestSubscription`. Send the wrong one and the catalogue silently comes back
empty.

> **Prices are NOT in the codebase.** `IAP_PRODUCT_IDS` holds one product id; the
> paywall displays only the `localizedPrice` the store returns. Hardcoding a
> figure would desync from what the user is actually charged, and App Store
> review rejects a displayed price that differs from the storefront's.

Configure per storefront:

| Storefront | Lifetime | Yearly |
| --- | --- | --- |
| Worldwide (base) | **$39.99** | **$19.99 / year** |
| Tunisia | **39.99 TND** | **19.99 TND / year** |

- **App Store Connect** — create the lifetime product as a **Non-Consumable**
  and the yearly as an **Auto-Renewable Subscription**. Set each base price,
  then override the Tunisia storefront manually (Apple otherwise derives it by
  FX from the base).
- **Play Console** — lifetime as a **one-time product**, yearly as a
  **subscription**; set an explicit per-country price for Tunisia on both.

The paired numbers are different amounts: 19.99 TND is roughly $6.40, so Tunisia
is priced at about a third of the base. That is normal purchasing-power regional
pricing — just be aware it is a discount, not a currency relabel.

**Why $19.99 and not more.** The price reflects what a paid tier would actually
gate — features with genuine marginal cost (weather API calls, cloud storage).
It is deliberately not priced as though the app were the whole product: the
sensor is the product and the app is its companion. Rod count is free (see
*Multiple rods*), so nothing ever stands between a customer and hardware they
have bought.

**Currently unused.** `SUBSCRIPTIONS_ENABLED` is false, so none of this is live.
It is kept configured so a paid tier is a flag flip rather than a rewrite.

### Two details that matter

**Restore is mandatory, not a courtesy.** For a non-consumable,
`getAvailablePurchases()` is the only way a user on a new device recovers their
entitlement, and Apple requires a working restore path that reviewers test.

**Lifetime wins over subscription** (`premiumSource.ts`). If someone holds both —
bought lifetime while a yearly plan was still running — the durable entitlement
is the truth, and the paywall tells them to cancel the redundant subscription,
since only the store can do that. Restore filters to active items, which on
StoreKit 2 does exclude lapsed subscriptions, but that is still the *client*
deciding it is entitled; only server-side receipt validation settles it. A
lifetime id needs no such judgement, which is why the one-off purchase is
strictly more reliable to restore.

**Still open:** selling a sensor + Pro kit through your own web checkout. Physical
goods sit outside App Store IAP rules, so a bundle keeps the full price on both
halves and converts hardware buyers without an in-app funnel at all.

---

## Revenue model — hardware only

**Sell the sensor; give the software away.** The app serves no ads and, by
default, gates nothing.

### Ads were removed, not disabled

There is no ad flag. `features/ads` is gone in its entirety — the AdMob SDK
dependency, the banner/native/interstitial placements, the rewarded-unlock
machinery, the offer arbiter and the fatigue ledger. Nothing dormant is left to
be switched on by accident.

Reasoning: an angler fishing three rods needs three sensors, and sensors are the
high-margin product at roughly $8 landed. Ads earned an estimated ~$2.50 per MAU
per year and cost friction at exactly the two moments that decide retention —
onboarding and the post-session payoff. One extra sensor sold is worth about six
years of that.

Three things came back for free by dropping them: no UMP consent prompt, no iOS
ATT prompt, and — see *Analytics* — no reason to keep the AdId-capable Firebase
pod, so the app can declare no tracking at all.

### Subscriptions: present, dormant, flag-gated

`SUBSCRIPTIONS_ENABLED` (`src/config/features.ts`, default **false**, set via
`FEATURE_SUBSCRIPTIONS`) decides whether a paid tier exists.

`useEntitlements` is the single choke point. With the flag off, `pro` is true for
everyone, so every gate opens at once — full 7-day outlook, unlimited history,
all alert sounds, no session time limit, cloud photo backup, complete session
reports, catch insights. **No screen knows the flag exists.**

Also off in that state: the IAP store connection is never opened (so the products
need not exist in the stores yet), and the Paywall route is not even registered —
a stray `navigate('Paywall')` fails loudly in development rather than opening a
screen that cannot sell anything.

Turning it on is a build-config change:

```
FEATURE_SUBSCRIPTIONS=true
```

The free-tier limits in `config/constants.ts` then apply, each mapped to a key in
`subscription/premiumFeatures.ts`. A limit with no key is unreachable; a key with
no limit is a lie on the paywall.

> One behavioural consequence worth knowing: with a paid tier enabled, a free
> user who exhausts the daily session allowance is sent to the paywall. There is
> no longer a rewarded ad to trade for another block, because there are no ads.

## Analytics

Firebase Analytics (`@react-native-firebase/analytics`) is wired through one
guarded service (`services/firebase/analytics.ts`) — every call is
fire-and-forget and can never crash the app. Instrumented events:

- **`screen_view`** — automatic, via the navigation container in `App.tsx`.
- **`login` / `sign_up`** — per method (email/google/apple/facebook), from `authStore`.
- **`bite_detected`** — the signature engagement event (size + confidence), from the detection hook.
- **`purchase`** — premium conversion, from `subscriptionStore`.
- User id is attached on auth state change (cleared on sign-out).

No manual iOS setup is needed — Analytics comes in via CocoaPods at
`expo prebuild` (like the other Firebase modules).

⚠️ **IDFA — worth acting on now.** The standard (AdId-capable) SDK is still
pulled in. That was correct while AdMob shipped; with ads gone the IDFA buys
nothing, yet its presence still forces an App Privacy *tracking* declaration and
an ATT prompt on iOS. Switch to the no-AdId pod by setting
`$RNFirebaseAnalyticsWithoutAdIdSupport = true` in the Podfile via a prebuild
config plugin.

---

## Setup

1. **Install**
   ```bash
   npm install
   ```
2. **Firebase** — create a project, enable **Email/Password + Google** auth and
   **Firestore**. (**Storage** is optional: catch photos are always saved
   on-device for free; premium users additionally get a cloud backup, which
   needs Storage on the paid Blaze plan.)
   Download and place at the repo root:
   - `google-services.json` (Android)
   - `GoogleService-Info.plist` (iOS)

   Both are git-ignored. Deploy the Firestore rules (add `storage` only if you
   enable Storage):
   ```bash
   firebase deploy --only firestore:rules
   ```
3. **Env** — `cp .env.example .env` and fill in the Google web client ID. Leave
   `FEATURE_SUBSCRIPTIONS=false` unless you actually want a paid tier.
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
| Google sign-in | `services/firebase/auth.ts`, `SignInScreen` |
| Subscription removes ads / unlocks | `features/subscription/useEntitlements` — single gate read by every ad surface |
| Environmental data through the day | `features/environment` (Open-Meteo, hourly forecast + best window) |
| BLE + auto-reconnect | `features/ble` — Minew E8S broadcast scan (`E8sSensorClient`, `minew.ts`), staleness-resilient |
| Bite detection (Kalman + MA), small/big | `features/bite-detection` |
| Live bait mode / sensitivity | `settingsStore` → `BiteDetector.setConfig` + device control write |
| Feedback: vibration / sound / push | `features/notifications/feedback.ts` |
| Graph + highlighted bites | `features/graph/AccelerationChart` |
| Bite history (+ catch photo) | `features/bite-history` (Firestore; photos on-device via `photoStorage`, cloud backup for premium via Storage) |
| Settings persist across restarts | `settingsStore` (zustand `persist` + AsyncStorage) |
| Ads for non-premium | `features/ads` (policy-gated; see “Monetization”) |

## Follow-ups (noted, not blocking)

- Real device geolocation (`expo-location`) to replace `DEFAULT_COORDS`.
- Bundle notification sound assets (`assets/sounds/`) and register them.
- Server-side IAP receipt validation before granting entitlements.
- Premium cloud photo backup needs Firebase Storage (Blaze). Free users' photos
  stay on-device; premium uploads + a one-time backfill activate automatically.
- Multi-tag picker: `E8sSensorClient` currently locks onto the first E8S seen
  (fine for one rod). It already collects `getDiscoveredTags()` (by RSSI) — wire
  a selection UI + remembered MAC for anglers running multiple tags.
- Configure each E8S in Minew **BeaconSET+**: fastest advertising interval +
  motion trigger for best bite responsiveness.

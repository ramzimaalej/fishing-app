/**
 * English — the base locale and the fallback for every other language.
 *
 * This file is the source of truth: add a key here first, then translate it in
 * fr.ts / es.ts. The `Resources` type is derived from this object, so a missing
 * or misspelled key in a translation is a TypeScript error rather than a string
 * that silently renders as its own key at runtime.
 *
 * Plurals use i18next's `_one` / `_other` suffixes driven by Intl.PluralRules,
 * so each language gets its own CLDR categories rather than an English
 * "n === 1" assumption baked into the call site.
 */
const en = {
  common: {
    cancel: 'Cancel',
    save: 'Save',
    remove: 'Remove',
    back: 'Back',
    done: 'Done',
    retry: 'Pull down to retry.',
    loading: 'Loading…',
    notNow: 'Not now',
    watchAd: 'Watch ad',
    keepIt: 'Keep it',
    unlocked: 'Unlocked',
    until: 'Until {{time}}',
  },

  tabs: {
    fishing: 'Fishing',
    conditions: 'Conditions',
    history: 'History',
    settings: 'Settings',
  },

  fishing: {
    title: 'Fishing',
    start: 'Start',
    stop: 'Stop',
    manage: 'Manage',
    rodCount_one: '{{count}} rod',
    rodCount_other: '{{count}} rods',
    monitoring: 'monitoring',
    idle: 'idle',
    addRodFirst: 'Add a rod first.',
    bites: 'Bites',
    threshold: 'Threshold',
    sensor: 'Sensor',
    bigFish: 'Big fish!',
    nibble: 'Nibble',
    bitePeak: 'Peak {{peak}} g · {{confidence}}% confidence',
    liveBait: 'Live bait mode',
    liveBaitHelp: 'Filters constant bait motion — applies to every rod',
    status: {
      idle: 'Not armed',
      poweredOff: 'Bluetooth off',
      unauthorized: 'Permission needed',
      scanning: 'Scanning…',
      connecting: 'Connecting…',
      connected: 'Live',
      reconnecting: 'Reconnecting…',
      error: 'Error',
      calibrating: 'Calibrating',
      ready: 'Ready',
    },
  },

  session: {
    label: 'Session',
    ended: 'Session ended',
    endingSoon: 'Ending soon',
    noLimit: 'No time limit',
    remaining: '{{time}} left',
    notMonitored: 'Rods are no longer monitored',
    extend: '+{{hours}}h',
    upsell: 'Premium fishes without a time limit — no ads, no interruptions.',
    expired: 'expired',
    underMinute: 'under a minute',
    warnTitle: '⏳ Session ending soon',
    warnBody: 'Your rods stop being monitored shortly. Open Castmate to add more time.',
    endedTitle: '🛑 Session ended',
    endedBody: 'Your rods are no longer being monitored. Open Castmate to carry on fishing.',
  },

  rods: {
    title: 'Rods',
    intro:
      'Each rod runs its own detector and its own alarm, so a bite alert tells you which rod to pick up.',
    addRod: '＋ Add rod',
    addRodCount: '＋ Add rod ({{current}}/{{max}})',
    maxTitle: 'Maximum rods',
    maxBody: 'Castmate monitors up to {{max}} rods at once.',
    removeTitle: 'Remove rod',
    removeBody: 'Remove “{{name}}”? Logged bites are kept.',
    firstRodFixed: 'Your first rod can’t be removed.',
    armed: 'armed',
    sensorLabel: 'Sensor',
    pairedSensor: 'Paired sensor',
    notPaired: 'Not paired — tap to pair',
    pairHint: 'Each rod must be bound to its own sensor, or two rods would read the same one.',
    nameTitle: 'Rod name',
    namePlaceholder: 'e.g. Left rod',
    defaultName: 'Rod {{number}}',
  },

  pairing: {
    title: 'Pair {{name}}',
    subtitleBroadcast:
      'Move the tag you want for this rod — the one with the strongest signal is usually nearest.',
    subtitleGatt: 'Looking for {{device}} devices.',
    currentlyPaired: 'Currently paired',
    unpair: 'Unpair',
    scanning: 'Scanning…',
    takenBy: 'Already paired to {{name}} — tap to move it here',
    rodNotFound: 'Rod not found.',
    permissionDenied: 'Bluetooth permission denied.',
    bluetoothUnavailable: 'Bluetooth unavailable.',
  },

  conditions: {
    title: 'Conditions',
    loading: 'Loading local conditions…',
    loadFailed: 'Failed to load conditions.',
    fishActivity: 'Fish activity',
    pressure: 'Pressure',
    temperature: 'Temperature',
    wind: 'Wind',
    waveHeight: 'Wave height',
    tide: 'Tide',
    moon: 'Moon',
    bestWindow: '🎣 Best window today around {{time}} ({{percent}}%)',
    hourlyForecast: 'Hourly forecast',
    outlook: 'Outlook',
    lockedDays_one: '🔒 {{count}} more day in the full outlook',
    lockedDays_other: '🔒 {{count}} more days in the full outlook',
    today: 'Today',
    tomorrow: 'Tomorrow',
    bestTimesLink: 'Best times calendar',
    bestTimesSub: 'Solunar outlook for the month — plan your next trip',
  },

  bestTimes: {
    title: 'Best times',
    subtitle:
      'Solunar outlook — the major feeding periods follow the new and full moon. Moon-based, so it reaches further ahead than the weather forecast.',
    rating: 'Rating',
    moon: 'Moon',
    moonLit: '{{name}} · {{percent}}% lit',
    hint: 'Fish the dawn and dusk windows — they carry the most weight on any rating.',
    topDays: 'Top days this month',
    ratings: {
      excellent: 'excellent',
      good: 'good',
      fair: 'fair',
      poor: 'poor',
    },
  },

  history: {
    title: 'Bite History',
    insights: '📊 Insights',
    emptyTitle: 'No bites logged yet',
    emptySub: 'Connect your sensor and start fishing — detected bites appear here.',
    metrics: 'peak {{peak}} g · {{confidence}}% confidence',
    addNote: 'Add a note…',
    noteTitle: 'Note',
    notePlaceholder: 'e.g. rainbow trout, spinner lure',
    backedUp: '☁️ Backed up',
    onDevice: '📱 On this device',
    replace: 'Replace',
    saving: 'Saving…',
    hidden_one: '🔒 {{count}} older bite beyond the last {{days}} days',
    hidden_other: '🔒 {{count}} older bites beyond the last {{days}} days',
    permissionTitle: 'Permission needed',
    permissionBody: 'Allow photo access to attach a catch photo.',
    photoFailedTitle: 'Could not attach photo',
    photoFailedBody: 'Please try again.',
    saveFailedTitle: 'Save failed',
    saveFailedBody: 'Could not save note.',
  },

  report: {
    title: 'Session report',
    noSessionTitle: 'No session to report',
    noSessionSub: 'Finish a fishing session and its debrief appears here.',
    bites: 'Bites',
    duration: 'Duration',
    bestStrike: 'Best strike',
    noBitesTitle: 'No bites this time',
    noBitesSub:
      'Blank sessions happen. Check the Conditions tab for the next good window before you head out again.',
    timeline: 'Bite timeline',
    byRod: 'By rod',
    rodTally_one: '{{count}} bite · peak {{peak}} g',
    rodTally_other: '{{count}} bites · peak {{peak}} g',
    breakdown: 'Strike breakdown',
    bigFish: 'Big fish',
    nibbles: 'Nibbles',
    biteRate: 'Bite rate',
    biteRateValue: '{{rate}} / hour',
    meanConfidence: 'Mean confidence',
    hottest: '🔥 Hottest half hour: {{time}} — {{count}} bites',
    conditionsTitle: 'Conditions that produced them',
    air: 'Air',
    lockedHint: '🔒 Unlock to see the full breakdown',
  },

  insights: {
    title: 'Catch insights',
    subtitle:
      'Your bites matched against ERA5 reanalysis — the corrected historical record, not a forecast. Each condition is scored by how often it produced a bite relative to how often it actually occurred, over the last {{days}} days.',
    loading: 'Loading historical conditions…',
    loadFailed: 'Could not load historical conditions.',
    notEnoughTitle: 'Not enough data yet',
    notEnoughBody:
      '{{matched}} of {{needed}} bites matched to historical conditions. Keep fishing — the analysis needs a real sample before it can tell you anything honest.',
    locked: '🔒 Unlock to see which conditions produced your bites',
    best: 'best: {{label}}',
    vsChance: 'vs. chance',
    lift: 'lift',
    count: 'n',
    howToRead: 'How to read this',
    liftExplainer:
      'is how much more often a condition produced a bite than chance would predict. 1.0× is exactly average; 2.0× means twice as productive as its frequency alone would suggest.',
    countExplainer: 'is the number of bites in that band.',
    caveat:
      'This corrects for how common each condition was, but not for when you chose to fish. If you only ever fish at dawn, dawn will lead regardless of the fish.',
    footnote: '{{matched}} bites analysed against {{hours}} hours of reanalysis.',
    footnoteExcluded: ' {{count}} outside the window or without data.',
    footnotePending: ' {{count}} too recent — reanalysis lags a few days.',
    headline: '{{label}} — {{dimension}} — produced bites {{lift}}× more often than chance.',
    dimensions: {
      pressureTrend: 'Barometric trend',
      temperature: 'Air temperature',
      wind: 'Wind',
      timeOfDay: 'Time of day',
      moon: 'Moon',
      tide: 'Tide',
    },
  },

  settings: {
    detection: 'Detection',
    liveBait: 'Live Bait Mode',
    liveBaitHelp:
      'Adapts to constant bait motion so a lively bait isn’t mistaken for a bite.',
    sensitivity: 'Bite Sensitivity',
    sensitivityHelp:
      'Higher sensitivity detects smaller nibbles; lower ignores all but strong strikes.',
    alerts: 'Alerts',
    vibration: 'Vibration',
    sound: 'Sound',
    preview: 'Preview',
    push: 'Push Notifications',
    pushHelp: 'Get a notification the moment a bite is detected.',
    pushDeniedTitle: 'Notifications disabled',
    pushDeniedBody:
      'Enable notifications for Castmate in your device Settings to receive bite alerts.',
    language: 'Language',
    languageSystem: 'System default',
    premium: 'Premium',
    premiumActive: 'Premium active',
    premiumLifetime: 'Premium — lifetime',
    premiumTitle: 'Castmate Premium',
    premiumThanks: 'Ads removed and all features unlocked. Thank you!',
    premiumRenews: 'Renews yearly. Manage it in your store account settings.',
    premiumPitch: 'Remove ads and unlock everything.',
    upgrade: 'Upgrade',
    restore: 'Restore purchases',
    working: 'Working…',
    account: 'Account',
    signedIn: 'Signed in',
    signOut: 'Sign out',
    resetTitle: 'Reset settings',
    resetBody: 'Restore all settings to their defaults?',
    reset: 'Reset',
    resetToDefaults: 'Reset to defaults',
  },

  paywall: {
    title: 'Castmate Premium',
    subhead: 'Fish smarter. No interruptions.',
    yourePremium: 'You’re Premium ✓',
    lifetimeActive: 'Premium — yours for life ✓',
    thanks: 'Thanks for supporting Castmate.',
    renewsYearly: 'Renews yearly. Manage it in your store account settings.',
    cancelWarning:
      'You also have an active yearly plan. Cancel it in your store account settings — your lifetime unlock already covers everything.',
    planNote: 'Both unlock exactly the same features. Lifetime is a single payment — no renewal.',
    restore: 'Restore purchases',
    legal:
      'The yearly plan renews automatically until cancelled; manage or cancel it anytime in your store account settings. The lifetime unlock is a one-time purchase and does not renew.',
    plans: {
      lifetimeTitle: 'Lifetime',
      lifetimeBlurb: 'One payment, yours forever',
      lifetimeTag: 'Best value',
      yearlyTitle: 'Yearly',
      yearlyBlurb: 'Renews each year until cancelled',
    },
    benefits: {
      noAds: 'Remove all ads',
      outlook: 'Full 7-day bite outlook',
      insights: 'Catch insights from your own history',
      reports: 'Complete session reports',
      history: 'Unlimited bite history',
      sounds: 'All alert sounds',
      backup: 'Cloud backup for catch photos',
    },
  },

  rewards: {
    extendedForecast: {
      title: 'Unlock the full 7-day outlook',
      blurb: 'Plan the whole week — peak feeding window for every day.',
    },
    catchInsights: {
      title: 'Unlock your catch insights',
      blurb: 'The barometer, temperature and tide that actually produced your bites.',
    },
    sessionReport: {
      title: 'Unlock the full session report',
      blurb: 'Bite timeline, strike strength breakdown and the conditions that produced them.',
    },
    historyDepth: {
      title: 'See your full bite history',
      blurb: 'Open everything older than the last 30 days for a day.',
    },
    soundPack: {
      title: 'Unlock all alert sounds',
      blurb: 'Bite Bell and Sonar Ping, yours for the week.',
    },
    photoBackup: {
      title: 'Back up this catch to the cloud',
      blurb: 'Keep the photo safe even if you lose or change phone.',
    },
    watchToUnlock: '{{blurb}} Watch one short ad to unlock {{duration}}.',
    durations: {
      hours_one: 'for {{count}} hour',
      hours_other: 'for {{count}} hours',
      days_one: 'for {{count}} day',
      days_other: 'for {{count}} days',
      minutes_one: 'for {{count}} minute',
      minutes_other: 'for {{count}} minutes',
    },
  },

  ads: {
    label: 'Ad',
  },

  chart: {
    waiting: 'Waiting for sensor data…',
    acceleration: 'Acceleration (g)',
    threshold: 'Threshold',
    smallBite: 'Small bite',
    bigBite: 'Big bite',
  },

  auth: {
    signIn: 'Sign in',
    signUp: 'Sign up',
    tagline: 'Sign in to track your bites',
    email: 'Email',
    password: 'Password',
    passwordMin: 'Password (min 6 characters)',
    confirmPassword: 'Confirm password',
    createAccount: 'Create account',
    createOne: 'Create one',
    continueGoogle: 'Continue with Google',
    demoMode: 'Continue in demo mode (dev only)',
    verifyTitle: 'Confirm your email',
    resend: 'Resend email',
    signOut: 'Sign out',
  },
} as const;

export default en;

/** Shape every other locale must satisfy. */
export type Resources = typeof en;

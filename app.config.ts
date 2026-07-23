import { ExpoConfig, ConfigContext } from 'expo/config';

/**
 * Dynamic Expo config.
 *
 * All native modules used here (react-native-firebase, react-native-ble-plx,
 * react-native-google-mobile-ads, IAP) require a custom dev client / prebuild —
 * they do NOT run in Expo Go. Run `npm run prebuild` then `npm run ios|android`.
 *
 * Secrets (AdMob IDs, Google web client id) come from environment variables so
 * they never land in source control. See `.env.example`.
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Castmate',
  slug: 'castmate',
  version: '0.1.0',
  orientation: 'portrait',
  scheme: 'castmate',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'co.castmate',
    // GoogleService-Info.plist is generated from your Firebase project.
    googleServicesFile: process.env.GOOGLE_SERVICES_PLIST ?? './GoogleService-Info.plist',
    infoPlist: {
      NSBluetoothAlwaysUsageDescription:
        'Castmate uses Bluetooth to connect to your bite sensor and read motion data in real time.',
      NSBluetoothPeripheralUsageDescription:
        'Castmate uses Bluetooth to connect to your bite sensor.',
      NSLocationWhenInUseUsageDescription:
        'Location is used to fetch accurate local weather, tide and marine conditions.',
      NSCameraUsageDescription: 'Attach a photo of your catch to a detected bite.',
      NSPhotoLibraryUsageDescription: 'Attach a photo of your catch to a detected bite.',
      UIBackgroundModes: ['bluetooth-central', 'remote-notification'],
    },
  },
  android: {
    package: 'co.castmate',
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json',
    permissions: [
      'BLUETOOTH_SCAN',
      'BLUETOOTH_CONNECT',
      'ACCESS_FINE_LOCATION',
      'POST_NOTIFICATIONS',
      'VIBRATE',
    ],
  },
  plugins: [
    'expo-dev-client',
    '@react-native-firebase/app',
    '@react-native-firebase/auth',
    [
      'expo-build-properties',
      {
        ios: { useFrameworks: 'static' },
        // Kotlin 1.9.25 to match the Compose Compiler 1.5.15 pulled in by a
        // native dependency (SDK 52's default 1.9.24 mismatches it).
        android: { minSdkVersion: 24, kotlinVersion: '1.9.25' },
      },
    ],
    [
      'react-native-ble-plx',
      {
        isBackgroundEnabled: true,
        modes: ['central'],
        bluetoothAlwaysPermission:
          'Castmate uses Bluetooth to connect to your bite sensor.',
      },
    ],
    [
      'react-native-google-mobile-ads',
      {
        androidAppId: process.env.ADMOB_ANDROID_APP_ID ?? 'ca-app-pub-3940256099942544~3347511713',
        iosAppId: process.env.ADMOB_IOS_APP_ID ?? 'ca-app-pub-3940256099942544~1458002511',
        // Shown by the iOS ATT prompt (UMP drives it when configured in AdMob).
        userTrackingUsageDescription:
          'This identifier will be used to show you fewer, more relevant ads.',
      },
    ],
    [
      'expo-notifications',
      { sounds: [] },
    ],
    '@react-native-google-signin/google-signin',
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'Location is used to fetch accurate local weather, tide and marine conditions.',
      },
    ],
    // react-native-iap needs an Android store flavor selected (Play).
    './plugins/withIapAndroidFlavor',
  ],
  extra: {
    googleWebClientId: process.env.GOOGLE_WEB_CLIENT_ID ?? '',
    // Per-slot AdMob unit ids. Dev builds always use Google's test ids; in
    // production a missing value falls back to test ids (never crashes).
    admob: {
      banner: {
        ios: process.env.ADMOB_BANNER_ID_IOS ?? '',
        android: process.env.ADMOB_BANNER_ID_ANDROID ?? '',
      },
      interstitial: {
        ios: process.env.ADMOB_INTERSTITIAL_ID_IOS ?? '',
        android: process.env.ADMOB_INTERSTITIAL_ID_ANDROID ?? '',
      },
      rewarded: {
        ios: process.env.ADMOB_REWARDED_ID_IOS ?? '',
        android: process.env.ADMOB_REWARDED_ID_ANDROID ?? '',
      },
    },
    eas: { projectId: process.env.EAS_PROJECT_ID ?? '' },
  },
});

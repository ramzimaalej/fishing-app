import { ExpoConfig, ConfigContext } from 'expo/config';

/**
 * Dynamic Expo config.
 *
 * All native modules used here (react-native-firebase, react-native-ble-plx,
 * IAP, expo-localization) require a custom dev client / prebuild —
 * they do NOT run in Expo Go. Run `npm run prebuild` then `npm run ios|android`.
 *
 * Secrets (Google web client id) come from environment variables so
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
      'expo-notifications',
      { sounds: [] },
    ],
    '@react-native-google-signin/google-signin',
    // Exposes the device's preferred locales so the app can pick a language.
    'expo-localization',
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'Location is used to fetch accurate local weather, tide and marine conditions.',
      },
    ],
    // react-native-iap needs an Android store flavor selected (Play).
    './plugins/withIapAndroidFlavor',
    // Manifest-only: declares intent for long-running BLE scanning. Does NOT
    // create a foreground service — see features/detection/platformLimits.ts.
    './plugins/withScanningPermissions',
    // No ads → no advertising identifier, on either platform.
    './plugins/withoutAnalyticsAdId',
  ],
  extra: {
    /**
     * Monetization toggle. Default OFF — the revenue model is hardware-only:
     * sell the sensor, give the software away. Ads are not merely disabled but
     * removed entirely; see src/config/features.ts.
     */
    features: {
      subscriptions: process.env.FEATURE_SUBSCRIPTIONS ?? 'false',
    },
    googleWebClientId: process.env.GOOGLE_WEB_CLIENT_ID ?? '',
    eas: { projectId: process.env.EAS_PROJECT_ID ?? '' },
  },
});

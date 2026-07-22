import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';

import App from './App';

// Register the FCM background/quit-state message handler OUTSIDE the React tree,
// as required by react-native-firebase. Guarded so a missing/misconfigured
// native module never crashes startup (e.g. before google-services is added).
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getMessaging, setBackgroundMessageHandler } = require('@react-native-firebase/messaging');
  setBackgroundMessageHandler(getMessaging(), async () => {
    // Data-only bite alerts can be handled here; display is driven by the OS.
  });
} catch {
  // messaging not available in this environment — ignore
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App)
// and sets up the environment for both Expo Go and native builds.
registerRootComponent(App);

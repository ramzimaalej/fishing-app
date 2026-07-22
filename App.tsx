import { useRef } from 'react';
import { StatusBar } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  DarkTheme,
  NavigationContainer,
  createNavigationContainerRef,
  type Theme,
} from '@react-navigation/native';

import RootNavigator from '@/app/navigation/RootNavigator';
import { trackScreen } from '@/services/firebase/analytics';
import { colors } from '@/theme';

const navTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bg,
    card: colors.surface,
    text: colors.text,
    primary: colors.primary,
    border: colors.border,
    notification: colors.accent,
  },
};

const navigationRef = createNavigationContainerRef<Record<string, object | undefined>>();

export default function App() {
  const routeNameRef = useRef<string | undefined>(undefined);

  // Automatic GA4 screen_view tracking: log the active route whenever it changes.
  const onReady = () => {
    routeNameRef.current = navigationRef.getCurrentRoute()?.name;
    if (routeNameRef.current) trackScreen(routeNameRef.current);
  };
  const onStateChange = () => {
    const previous = routeNameRef.current;
    const current = navigationRef.getCurrentRoute()?.name;
    if (current && previous !== current) {
      trackScreen(current);
      routeNameRef.current = current;
    }
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
        <NavigationContainer
          ref={navigationRef}
          theme={navTheme}
          onReady={onReady}
          onStateChange={onStateChange}
        >
          <RootNavigator />
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

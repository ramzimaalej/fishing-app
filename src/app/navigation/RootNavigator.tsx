import { useEffect } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useAuth } from '@/features/auth/useAuth';
import { useAuthStore } from '@/features/auth/authStore';
import SignInScreen from '@/features/auth/screens/SignInScreen';
import SignUpScreen from '@/features/auth/screens/SignUpScreen';
import VerifyEmailScreen from '@/features/auth/screens/VerifyEmailScreen';
import BiteHistoryScreen from '@/features/bite-history/BiteHistoryScreen';
import EnvironmentScreen from '@/features/environment/EnvironmentScreen';
import FishingScreen from '@/features/fishing/FishingScreen';
import SettingsScreen from '@/features/settings/SettingsScreen';
import PaywallScreen from '@/features/subscription/PaywallScreen';
import { useSubscriptionStore } from '@/features/subscription/subscriptionStore';
import { colors, typography } from '@/theme';

export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
  Paywall: undefined;
};

const RootStack = createNativeStackNavigator<RootStackParamList>();
const AuthStack = createNativeStackNavigator();
const Tabs = createBottomTabNavigator();

function TabIcon({ icon, color }: { icon: string; color: string }) {
  return <Text style={{ fontSize: 20, color }}>{icon}</Text>;
}

function MainTabs() {
  return (
    <Tabs.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTitleStyle: { color: colors.text },
        headerShadowVisible: false,
        headerShown: false,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
      }}
    >
      <Tabs.Screen
        name="Fishing"
        component={FishingScreen}
        options={{ tabBarIcon: ({ color }) => <TabIcon icon="🎣" color={color} /> }}
      />
      <Tabs.Screen
        name="Conditions"
        component={EnvironmentScreen}
        options={{ tabBarIcon: ({ color }) => <TabIcon icon="🌊" color={color} /> }}
      />
      <Tabs.Screen
        name="History"
        component={BiteHistoryScreen}
        options={{
          headerShown: true,
          title: 'Bite history',
          tabBarIcon: ({ color }) => <TabIcon icon="📈" color={color} />,
        }}
      />
      <Tabs.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          headerShown: true,
          tabBarIcon: ({ color }) => <TabIcon icon="⚙️" color={color} />,
        }}
      />
    </Tabs.Navigator>
  );
}

function AuthNavigator({ startVerified }: { startVerified: boolean }) {
  return (
    <AuthStack.Navigator
      initialRouteName={startVerified ? 'VerifyEmail' : 'SignIn'}
      screenOptions={{ headerShown: false }}
    >
      <AuthStack.Screen name="SignIn" component={SignInScreen} />
      <AuthStack.Screen name="SignUp" component={SignUpScreen} />
      <AuthStack.Screen name="VerifyEmail" component={VerifyEmailScreen} />
    </AuthStack.Navigator>
  );
}

function Splash() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: 48 }}>🎣</Text>
      <Text style={{ ...typography.h2, color: colors.text, marginTop: 12 }}>Castmate</Text>
      <ActivityIndicator color={colors.primary} style={{ marginTop: 16 }} />
    </View>
  );
}

export default function RootNavigator() {
  const { initializing, isAuthenticated, isVerified } = useAuth();

  // Bootstrap auth + IAP once for the app lifetime.
  useEffect(() => {
    const unsubscribe = useAuthStore.getState().bootstrap();
    void useSubscriptionStore.getState().init();
    return () => {
      unsubscribe();
      useSubscriptionStore.getState().teardown();
    };
  }, []);

  if (initializing) return <Splash />;

  const fullyIn = isAuthenticated && isVerified;

  return (
    <RootStack.Navigator screenOptions={{ headerShown: false }}>
      {fullyIn ? (
        <>
          <RootStack.Screen name="Main" component={MainTabs} />
          <RootStack.Screen
            name="Paywall"
            component={PaywallScreen}
            options={{ presentation: 'modal' }}
          />
        </>
      ) : (
        <RootStack.Screen name="Auth">
          {() => <AuthNavigator startVerified={isAuthenticated && !isVerified} />}
        </RootStack.Screen>
      )}
    </RootStack.Navigator>
  );
}

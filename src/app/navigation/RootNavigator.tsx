import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Text, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { SUBSCRIPTIONS_ENABLED } from '@/config/features';
import AdminScreen from '@/features/admin/AdminScreen';
import CalibrationScreen from '@/features/admin/CalibrationScreen';
import DetectionSettingsScreen from '@/features/admin/DetectionSettingsScreen';
import SnifferScreen from '@/features/admin/SnifferScreen';
import { useAuth } from '@/features/auth/useAuth';
import { useAuthStore } from '@/features/auth/authStore';
import SignInScreen from '@/features/auth/screens/SignInScreen';
import SignUpScreen from '@/features/auth/screens/SignUpScreen';
import VerifyEmailScreen from '@/features/auth/screens/VerifyEmailScreen';
import BiteHistoryScreen from '@/features/bite-history/BiteHistoryScreen';
import BestTimesScreen from '@/features/environment/BestTimesScreen';
import EnvironmentScreen from '@/features/environment/EnvironmentScreen';
import FishingScreen from '@/features/fishing/FishingScreen';
import CatchInsightsScreen from '@/features/insights/CatchInsightsScreen';
import LocationScreen from '@/features/location/LocationScreen';
import PairSensorScreen from '@/features/rods/PairSensorScreen';
import RodsScreen from '@/features/rods/RodsScreen';
import { useRodRuntimeBridge } from '@/features/rods/useRodRuntime';
import SessionReportScreen from '@/features/session-report/SessionReportScreen';
import SettingsScreen from '@/features/settings/SettingsScreen';
import PaywallScreen from '@/features/subscription/PaywallScreen';
import { useSubscriptionStore } from '@/features/subscription/subscriptionStore';
import { colors, typography } from '@/theme';

export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
  Paywall: undefined;
  SessionReport: undefined;
  BestTimes: undefined;
  CatchInsights: undefined;
  Location: undefined;
  Rods: undefined;
  PairSensor: { rodId: string };
  Admin: undefined;
  Sniffer: undefined;
  Calibration: undefined;
  DetectionSettings: undefined;
};

const RootStack = createNativeStackNavigator<RootStackParamList>();
const AuthStack = createNativeStackNavigator();
const Tabs = createBottomTabNavigator();

function TabIcon({ icon, color }: { icon: string; color: string }) {
  return <Text style={{ fontSize: 20, color }}>{icon}</Text>;
}

function MainTabs() {
  const { t } = useTranslation();
  // Mounted here, above the tabs, so the rod runtime outlives any single screen.
  // Inside FishingScreen its teardown would disarm every rod on a tab switch.
  useRodRuntimeBridge();

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
        options={{
          title: t('tabs.fishing'),
          tabBarIcon: ({ color }) => <TabIcon icon="🎣" color={color} />,
        }}
      />
      <Tabs.Screen
        name="Conditions"
        component={EnvironmentScreen}
        options={{
          title: t('tabs.conditions'),
          tabBarIcon: ({ color }) => <TabIcon icon="🌊" color={color} />,
        }}
      />
      <Tabs.Screen
        name="History"
        component={BiteHistoryScreen}
        options={{
          headerShown: true,
          title: t('history.title'),
          tabBarIcon: ({ color }) => <TabIcon icon="📈" color={color} />,
        }}
      />
      <Tabs.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          title: t('tabs.settings'),
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
  const { t } = useTranslation();
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
          {/* Not registered at all when subscriptions are disabled, so a stray
              navigate('Paywall') fails loudly in development instead of opening
              a screen that cannot sell anything. */}
          {SUBSCRIPTIONS_ENABLED && (
            <RootStack.Screen
              name="Paywall"
              component={PaywallScreen}
              options={{ presentation: 'modal' }}
            />
          )}
          {/* Post-session debrief, pushed once the session-end ad is dismissed. */}
          <RootStack.Screen
            name="SessionReport"
            component={SessionReportScreen}
            options={{ presentation: 'modal' }}
          />
          {/* Solunar planning calendar, pushed from Conditions. */}
          <RootStack.Screen
            name="BestTimes"
            component={BestTimesScreen}
            options={{ headerShown: true, title: t('bestTimes.title'), headerTintColor: colors.text }}
          />
          {/* ERA5 retrospective analysis, pushed from History. */}
          <RootStack.Screen
            name="CatchInsights"
            component={CatchInsightsScreen}
            options={{
              headerShown: true,
              title: t('insights.title'),
              headerTintColor: colors.text,
            }}
          />
          {/* Fishing location: device GPS or a searched city. */}
          <RootStack.Screen
            name="Location"
            component={LocationScreen}
            options={{ headerShown: true, title: t('location.title'), headerTintColor: colors.text }}
          />
          {/* Rod setup + per-rod sensor pairing, pushed from Fishing. */}
          <RootStack.Screen
            name="Rods"
            component={RodsScreen}
            options={{ headerShown: true, title: t('rods.title'), headerTintColor: colors.text }}
          />
          <RootStack.Screen
            name="PairSensor"
            component={PairSensorScreen}
            options={{
              headerShown: true,
              title: t('rods.pairedSensor'),
              headerTintColor: colors.text,
            }}
          />
          {/* Developer data-capture console, reached from Settings. Registered
              unconditionally — the code gate lives in the screen, so a locked
              admin still renders its own prompt rather than a missing route. */}
          <RootStack.Screen
            name="Admin"
            component={AdminScreen}
            options={{ headerShown: true, title: 'Admin', headerTintColor: colors.text }}
          />
          <RootStack.Screen
            name="Sniffer"
            component={SnifferScreen}
            options={{ headerShown: true, title: 'BLE sniffer', headerTintColor: colors.text }}
          />
          <RootStack.Screen
            name="Calibration"
            component={CalibrationScreen}
            options={{ headerShown: true, title: 'Calibration', headerTintColor: colors.text }}
          />
          <RootStack.Screen
            name="DetectionSettings"
            component={DetectionSettingsScreen}
            options={{ headerShown: true, title: 'Detection', headerTintColor: colors.text }}
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

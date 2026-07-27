/**
 * Bite feedback: haptics, sound and local push notifications.
 *
 * expo-notifications is wired up as a plugin in app.config.ts. This module owns
 * the runtime concerns: requesting permission, installing a notification
 * handler, creating the Android channel, and firing an immediate local
 * notification when a bite is detected.
 *
 * Sound playback uses expo-av. Sound assets are NOT bundled yet — see
 * SOUND_ASSETS below. Until they are, sound gracefully degrades to a haptic
 * tick so nothing throws.
 */
import { Platform } from 'react-native';
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';

import type { AppSettings, BiteEvent } from '@/types';

const ANDROID_CHANNEL_ID = 'bite-alerts';

/**
 * Registry of playable notification sounds, keyed by the `soundKey` values in
 * NOTIFICATION_SOUNDS (@/config/constants). Intentionally EMPTY for now.
 *
 * Drop wav/mp3 files in assets/sounds/ and register them here, e.g.
 *   'bell': require('../../../assets/sounds/bell.wav'),
 * A missing entry falls back to a haptic tick instead of throwing.
 */
const SOUND_ASSETS: Partial<Record<string, number>> = {
  // 'classic-reel': require('../../../assets/sounds/classic-reel.wav'),
  // 'splash': require('../../../assets/sounds/splash.wav'),
  // 'bell': require('../../../assets/sounds/bell.wav'),
  // 'sonar': require('../../../assets/sounds/sonar.wav'),
};

let handlerInstalled = false;

/** Install the foreground notification handler + Android channel once. */
async function ensureNotificationSetup(): Promise<void> {
  if (!handlerInstalled) {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
        // Legacy fields (older SDK typings) — harmless if ignored.
        shouldShowAlert: true,
      }),
    });
    handlerInstalled = true;
  }

  if (Platform.OS === 'android') {
    try {
      await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
        name: 'Bite alerts',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 100, 250],
        enableVibrate: true,
      });
    } catch {
      /* channel creation is best-effort */
    }
  }
}

/**
 * Request notification permission. Returns true if granted. Safe to call
 * repeatedly; also installs the handler/channel.
 */
export async function requestNotificationPermissions(): Promise<boolean> {
  try {
    await ensureNotificationSetup();
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain && current.status === 'denied') return false;
    const requested = await Notifications.requestPermissionsAsync();
    return requested.granted;
  } catch {
    return false;
  }
}

/** Play (or preview) a notification sound by key, degrading to a haptic tick. */
async function playSound(key: string): Promise<void> {
  const asset = SOUND_ASSETS[key];
  if (asset === undefined) {
    // No bundled asset yet — give tactile feedback instead of silence/crash.
    try {
      await Haptics.selectionAsync();
    } catch {
      /* haptics unavailable */
    }
    return;
  }

  let sound: Audio.Sound | undefined;
  try {
    const created = await Audio.Sound.createAsync(asset, { shouldPlay: true });
    sound = created.sound;
    // Wait for playback to finish, then unload.
    await new Promise<void>((resolve) => {
      sound!.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) resolve();
        if (!status.isLoaded && status.error) resolve();
      });
    });
  } catch {
    /* playback failed — ignore */
  } finally {
    if (sound) {
      try {
        await sound.unloadAsync();
      } catch {
        /* already unloaded */
      }
    }
  }
}

/** Public helper for the settings screen "preview" tap. */
export async function playSoundPreview(soundKey: string): Promise<void> {
  await playSound(soundKey);
}

/**
 * Fire all enabled feedback channels for a detected bite. Each channel is
 * isolated so one failure never blocks the others.
 */
/**
 * @param rodName names the rod in the alert. With several rods armed, "a bite
 *   happened" is not actionable — the user needs to know which rod to pick up.
 *   Omitted for single-rod setups, where naming it just adds noise.
 */
export async function notifyBite(
  event: BiteEvent,
  settings: AppSettings,
  rodName?: string,
): Promise<void> {
  const isBig = event.size === 'big';

  const tasks: Promise<unknown>[] = [];

  if (settings.vibrationEnabled) {
    tasks.push(
      (async () => {
        try {
          if (isBig) {
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          } else {
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }
        } catch {
          /* haptics unavailable */
        }
      })(),
    );
  }

  if (settings.soundEnabled) {
    tasks.push(playSound(settings.soundKey));
  }

  if (settings.pushEnabled) {
    tasks.push(
      (async () => {
        try {
          await ensureNotificationSetup();
          const pct = Math.round(event.confidence * 100);
          const where = rodName ? ` — ${rodName}` : '';
          await Notifications.scheduleNotificationAsync({
            content: {
              title: (isBig ? '🎣 Big fish bite!' : '🐟 Nibble detected') + where,
              body: `Peak ${event.peakMagnitude.toFixed(2)} g · ${pct}% confidence`,
              ...(Platform.OS === 'android' ? { channelId: ANDROID_CHANNEL_ID } : {}),
            },
            trigger: null, // deliver immediately
          });
        } catch {
          /* notification failed — ignore */
        }
      })(),
    );
  }

  await Promise.allSettled(tasks);
}

/**
 * Identifier tag for session-window notifications, so they can be cancelled as
 * a group when the session ends or is extended.
 */
const SESSION_NOTIFICATION_IDS: string[] = [];

/**
 * Schedule the "session ending" warning and the "session ended" alert with the
 * OS.
 *
 * These MUST be OS-scheduled rather than JS timers: a free window is six hours
 * long and the app will be suspended for most of it, so a setTimeout would
 * simply never fire. An angler asleep beside three rods needs the warning to
 * arrive whatever the app is doing.
 *
 * Best-effort throughout — a failure here must never break the session itself.
 */
export async function scheduleSessionNotifications(
  expiresAt: number,
  warningAt: number | null,
): Promise<void> {
  await cancelSessionNotifications();
  try {
    await ensureNotificationSetup();
    const now = Date.now();
    const android = Platform.OS === 'android' ? { channelId: ANDROID_CHANNEL_ID } : {};

    if (warningAt !== null && warningAt > now) {
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: '⏳ Session ending soon',
          body: 'Your rods stop being monitored shortly. Open Castmate to add more time.',
          ...android,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(warningAt),
        },
      });
      SESSION_NOTIFICATION_IDS.push(id);
    }

    if (expiresAt > now) {
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: '🛑 Session ended',
          body: 'Your rods are no longer being monitored. Open Castmate to carry on fishing.',
          ...android,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(expiresAt),
        },
      });
      SESSION_NOTIFICATION_IDS.push(id);
    }
  } catch {
    /* scheduling unavailable — the in-app countdown still applies */
  }
}

/** Drop any pending session notifications (session ended, or was extended). */
export async function cancelSessionNotifications(): Promise<void> {
  const ids = SESSION_NOTIFICATION_IDS.splice(0, SESSION_NOTIFICATION_IDS.length);
  for (const id of ids) {
    try {
      await Notifications.cancelScheduledNotificationAsync(id);
    } catch {
      /* already fired or cancelled */
    }
  }
}

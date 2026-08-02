/**
 * Admin-mode gate.
 *
 * NOT A SECURITY BOUNDARY, and must never be used as one. The code below ships
 * inside the JS bundle, so anyone willing to unzip the APK can read it. Its job
 * is to keep a developer diagnostic out of the way of ordinary users and to stop
 * an accidental tap arming a data recorder — nothing behind it is sensitive, it
 * only reads the app's own accelerometer stream. If something genuinely
 * privileged ever hides here, this needs to become a server-checked capability.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

const ADMIN_CODE = '1928';

interface AdminState {
  unlocked: boolean;
  /** True when the code was right. Wrong codes leave the state untouched. */
  unlock: (code: string) => boolean;
  lock: () => void;
}

export const useAdminStore = create<AdminState>()(
  persist(
    (set) => ({
      // Persisted: the developer using this is re-entering it constantly during
      // a tuning session, and re-typing the code on every cold start is friction
      // with no upside given the note above.
      unlocked: false,
      unlock: (code) => {
        const ok = code.trim() === ADMIN_CODE;
        if (ok) set({ unlocked: true });
        return ok;
      },
      lock: () => set({ unlocked: false }),
    }),
    {
      name: 'castmate:admin',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ unlocked: s.unlocked }),
    },
  ),
);

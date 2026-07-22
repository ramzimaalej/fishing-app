import { create } from 'zustand';

import type { AppUser } from '@/types';
import {
  reloadCurrentUser,
  sendVerificationEmail,
  signInWithApple,
  signInWithEmail,
  signInWithFacebook,
  signInWithGoogle,
  signOutUser,
  signUpWithEmail,
  subscribeToAuth,
} from '@/services/firebase/auth';

interface AuthState {
  user: AppUser | null;
  initializing: boolean;
  busy: boolean;
  error: string | null;

  bootstrap: () => () => void;
  signInEmail: (email: string, password: string) => Promise<void>;
  signUpEmail: (email: string, password: string) => Promise<void>;
  signInGoogle: () => Promise<void>;
  signInApple: () => Promise<void>;
  signInFacebook: () => Promise<void>;
  signOut: () => Promise<void>;
  sendVerification: () => Promise<void>;
  reload: () => Promise<void>;
  clearError: () => void;
}

function messageOf(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return 'Something went wrong. Please try again.';
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  initializing: true,
  busy: false,
  error: null,

  bootstrap: () => {
    let settled = false;
    const unsubscribe = subscribeToAuth((user) => {
      set({ user, ...(settled ? {} : { initializing: false }) });
      settled = true;
    });
    return unsubscribe;
  },

  signInEmail: async (email, password) => {
    set({ busy: true, error: null });
    try {
      const user = await signInWithEmail(email, password);
      set({ user });
    } catch (err) {
      set({ error: messageOf(err) });
    } finally {
      set({ busy: false });
    }
  },

  signUpEmail: async (email, password) => {
    set({ busy: true, error: null });
    try {
      const user = await signUpWithEmail(email, password);
      // Require email confirmation before granting full access.
      await sendVerificationEmail();
      set({ user });
    } catch (err) {
      set({ error: messageOf(err) });
    } finally {
      set({ busy: false });
    }
  },

  signInGoogle: async () => {
    set({ busy: true, error: null });
    try {
      const user = await signInWithGoogle();
      set({ user });
    } catch (err) {
      set({ error: messageOf(err) });
    } finally {
      set({ busy: false });
    }
  },

  signInApple: async () => {
    set({ busy: true, error: null });
    try {
      const user = await signInWithApple();
      set({ user });
    } catch (err) {
      set({ error: messageOf(err) });
    } finally {
      set({ busy: false });
    }
  },

  signInFacebook: async () => {
    set({ busy: true, error: null });
    try {
      const user = await signInWithFacebook();
      set({ user });
    } catch (err) {
      set({ error: messageOf(err) });
    } finally {
      set({ busy: false });
    }
  },

  signOut: async () => {
    set({ busy: true, error: null });
    try {
      await signOutUser();
      set({ user: null });
    } catch (err) {
      set({ error: messageOf(err) });
    } finally {
      set({ busy: false });
    }
  },

  sendVerification: async () => {
    set({ busy: true, error: null });
    try {
      await sendVerificationEmail();
    } catch (err) {
      set({ error: messageOf(err) });
    } finally {
      set({ busy: false });
    }
  },

  reload: async () => {
    set({ busy: true, error: null });
    try {
      const user = await reloadCurrentUser();
      if (user) set({ user });
      else set({ user: get().user });
    } catch (err) {
      set({ error: messageOf(err) });
    } finally {
      set({ busy: false });
    }
  },

  clearError: () => set({ error: null }),
}));

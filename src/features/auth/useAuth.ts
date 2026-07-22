import type { AppUser } from '@/types';

import { useAuthStore } from './authStore';

export interface UseAuth {
  user: AppUser | null;
  isAuthenticated: boolean;
  isVerified: boolean;
  isPremium: boolean;
  initializing: boolean;
  busy: boolean;
  error: string | null;
}

/** Read-only auth snapshot derived from the auth store. */
export function useAuth(): UseAuth {
  const user = useAuthStore((s) => s.user);
  const initializing = useAuthStore((s) => s.initializing);
  const busy = useAuthStore((s) => s.busy);
  const error = useAuthStore((s) => s.error);

  return {
    user,
    isAuthenticated: user != null,
    isVerified: user?.emailVerified ?? false,
    isPremium: user?.isPremium ?? false,
    initializing,
    busy,
    error,
  };
}

/**
 * Free-tier history windowing — pure, so the rule is testable in isolation.
 *
 * The free tier keeps the most recent FREE_HISTORY_DAYS of bites readable.
 * Nothing is deleted or hidden destructively: older records stay in Firestore
 * and reappear the moment the user subscribes or takes the rewarded unlock.
 */

import { FREE_HISTORY_DAYS } from '@/config/constants';
import type { BiteRecord } from '@/types';

const DAY_MS = 86_400_000;

export interface HistoryWindow {
  /** Records the user may read right now, newest first (input order kept). */
  visible: BiteRecord[];
  /** How many records the free-tier window is withholding. */
  hiddenCount: number;
  /** Oldest timestamp still readable, or null when nothing is withheld. */
  cutoff: number | null;
}

/**
 * Split history into what's readable and what's behind the depth gate.
 * `unlocked` short-circuits everything — premium and rewarded users see all.
 */
export function applyHistoryWindow(
  records: BiteRecord[],
  unlocked: boolean,
  now: number = Date.now(),
): HistoryWindow {
  if (unlocked) return { visible: records, hiddenCount: 0, cutoff: null };

  const cutoff = now - FREE_HISTORY_DAYS * DAY_MS;
  const visible = records.filter((r) => r.timestamp >= cutoff);
  return {
    visible,
    hiddenCount: records.length - visible.length,
    cutoff: records.length === visible.length ? null : cutoff,
  };
}

/** One plotted sample of the live acceleration chart. */
export interface AccelPoint {
  t: number;
  /** Filtered dynamic acceleration (g) — the strike signal. */
  dynamic: number;
  /** The detector's adaptive threshold at this sample. */
  threshold: number;
}

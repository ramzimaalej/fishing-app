/** One plotted sample of the live acceleration chart. */
export interface AccelPoint {
  t: number;
  /**
   * Angular deviation from the rod's at-rest baseline, in DEGREES — the strike
   * signal. Was acceleration magnitude in g before the detector became
   * angle-based; the field keeps its name because renaming it would churn the
   * chart for no behavioural gain, but the unit is degrees.
   */
  dynamic: number;
  /** Deflection threshold in DEGREES at this sample. Fixed, not adaptive. */
  threshold: number;
}

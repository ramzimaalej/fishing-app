/**
 * Scalar (1-D) Kalman filter for smoothing a noisy accelerometer-derived
 * signal. Uses a constant-value process model:
 *
 *   predict:  x̂ₖ⁻ = x̂ₖ₋₁          Pₖ⁻ = Pₖ₋₁ + Q
 *   update:   K   = Pₖ⁻ / (Pₖ⁻ + R)
 *            x̂ₖ  = x̂ₖ⁻ + K·(zₖ − x̂ₖ⁻)
 *            Pₖ  = (1 − K)·Pₖ⁻
 *
 * - Q (process noise): how much the true value is expected to change between
 *   samples. Larger Q → filter tracks fast changes (a bite) more eagerly.
 * - R (measurement noise): sensor noise variance. Larger R → more smoothing.
 */
export interface KalmanOptions {
  /** Process noise covariance. */
  q?: number;
  /** Measurement noise covariance. */
  r?: number;
  /** Initial state estimate. */
  initialValue?: number;
  /** Initial estimate covariance. */
  initialCovariance?: number;
}

export class KalmanFilter {
  private q: number;
  private r: number;
  private x: number;
  private p: number;
  private readonly x0: number;
  private readonly p0: number;
  private initialised = false;

  constructor(options: KalmanOptions = {}) {
    this.q = options.q ?? 0.01;
    this.r = options.r ?? 0.25;
    this.x0 = options.initialValue ?? 0;
    this.p0 = options.initialCovariance ?? 1;
    this.x = this.x0;
    this.p = this.p0;
  }

  /** Feed one measurement, return the filtered estimate. */
  filter(measurement: number): number {
    if (!Number.isFinite(measurement)) {
      // Ignore garbage samples; hold the last estimate.
      return this.x;
    }

    // On the very first real measurement, seed the state to avoid a long
    // convergence ramp from an arbitrary initial value.
    if (!this.initialised) {
      this.x = measurement;
      this.initialised = true;
      return this.x;
    }

    // Predict.
    const pPredicted = this.p + this.q;

    // Update.
    const k = pPredicted / (pPredicted + this.r);
    this.x = this.x + k * (measurement - this.x);
    this.p = (1 - k) * pPredicted;

    return this.x;
  }

  /** Current filtered value without feeding a new measurement. */
  get value(): number {
    return this.x;
  }

  /** Current Kalman gain-relevant covariance (mostly for diagnostics/tests). */
  get covariance(): number {
    return this.p;
  }

  /** Adjust noise parameters at runtime (e.g. when sensitivity changes). */
  tune(q: number, r: number): void {
    this.q = q;
    this.r = r;
  }

  reset(): void {
    this.x = this.x0;
    this.p = this.p0;
    this.initialised = false;
  }
}

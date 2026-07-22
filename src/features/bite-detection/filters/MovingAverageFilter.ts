/**
 * Fixed-window moving-average filter over a ring buffer, maintaining running
 * mean and (population) variance in O(1) per sample via running sum / sum of
 * squares. Used both to smooth the signal and to estimate the rolling noise
 * floor the detector thresholds against.
 */
export class MovingAverageFilter {
  private readonly buffer: number[];
  private readonly size: number;
  private index = 0;
  private count = 0;
  private sum = 0;
  private sumSq = 0;

  constructor(windowSize: number) {
    if (!Number.isInteger(windowSize) || windowSize < 1) {
      throw new Error(`MovingAverageFilter window must be a positive integer, got ${windowSize}`);
    }
    this.size = windowSize;
    this.buffer = new Array(windowSize).fill(0);
  }

  /** Push a value and return the current mean of the window. */
  push(value: number): number {
    if (!Number.isFinite(value)) {
      return this.mean;
    }

    if (this.count === this.size) {
      // Window full — evict the oldest value before overwriting.
      const old = this.buffer[this.index] as number;
      this.sum -= old;
      this.sumSq -= old * old;
    } else {
      this.count += 1;
    }

    this.buffer[this.index] = value;
    this.sum += value;
    this.sumSq += value * value;
    this.index = (this.index + 1) % this.size;

    return this.mean;
  }

  get mean(): number {
    return this.count === 0 ? 0 : this.sum / this.count;
  }

  /** Population variance of the current window (>= 0, guarded against fp drift). */
  get variance(): number {
    if (this.count === 0) return 0;
    const m = this.mean;
    const v = this.sumSq / this.count - m * m;
    return v > 0 ? v : 0;
  }

  get std(): number {
    return Math.sqrt(this.variance);
  }

  get isFull(): boolean {
    return this.count === this.size;
  }

  get samples(): number {
    return this.count;
  }

  get windowSize(): number {
    return this.size;
  }

  reset(): void {
    this.buffer.fill(0);
    this.index = 0;
    this.count = 0;
    this.sum = 0;
    this.sumSq = 0;
  }
}

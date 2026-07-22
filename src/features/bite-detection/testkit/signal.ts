import type { AccelSample } from '@/types';

/**
 * Deterministic accelerometer-signal generator used by unit tests and the
 * offline validation harness. Not a test file itself (lives outside __tests__).
 *
 * Models a rig at rest: ~1 g of gravity on the Z axis plus Gaussian sensor
 * noise, with optional injected "bites" — half-sine acceleration bumps whose
 * peak amplitude (g) stands in for how hard a fish strikes.
 */

/** Seedable PRNG (LCG) → uniform in [0, 1). */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** Box–Muller Gaussian from a uniform source. */
function gaussian(rng: () => number): number {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export interface SignalOptions {
  sampleRateHz?: number;
  /** Sensor noise standard deviation (g). */
  noiseSigma?: number;
  seed?: number;
  /** Optional constant bait oscillation amplitude (g) — for live-bait tests. */
  baitAmplitudeG?: number;
  /** Bait oscillation frequency (Hz). */
  baitFreqHz?: number;
}

export class SignalBuilder {
  readonly samples: AccelSample[] = [];
  private readonly rate: number;
  private readonly dt: number;
  private readonly sigma: number;
  private readonly rng: () => number;
  private readonly baitAmp: number;
  private readonly baitFreq: number;
  private t = 0;
  private n = 0;

  constructor(opts: SignalOptions = {}) {
    this.rate = opts.sampleRateHz ?? 50;
    this.dt = 1000 / this.rate;
    this.sigma = opts.noiseSigma ?? 0.02;
    this.rng = makeRng(opts.seed ?? 12345);
    this.baitAmp = opts.baitAmplitudeG ?? 0;
    this.baitFreq = opts.baitFreqHz ?? 1.5;
  }

  private emit(extraZ: number): void {
    const bait =
      this.baitAmp > 0
        ? this.baitAmp * Math.sin((2 * Math.PI * this.baitFreq * this.n) / this.rate)
        : 0;
    this.samples.push({
      t: Math.round(this.t),
      x: this.sigma * gaussian(this.rng),
      y: this.sigma * gaussian(this.rng),
      z: 1 + bait + extraZ + this.sigma * gaussian(this.rng),
    });
    this.t += this.dt;
    this.n += 1;
  }

  /** Append `seconds` of quiet (baseline + noise + optional bait) signal. */
  quiet(seconds: number): this {
    const count = Math.round(seconds * this.rate);
    for (let i = 0; i < count; i++) this.emit(0);
    return this;
  }

  /** Inject one bite: a half-sine bump of `peakG` over `durationMs`. */
  bite(peakG: number, durationMs = 240): this {
    const count = Math.max(1, Math.round((durationMs / 1000) * this.rate));
    for (let i = 0; i < count; i++) {
      const bump = peakG * Math.sin((Math.PI * i) / count);
      this.emit(bump);
    }
    return this;
  }

  build(): AccelSample[] {
    return this.samples;
  }
}

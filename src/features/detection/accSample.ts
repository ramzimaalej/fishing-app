/**
 * Sample and parser contract for the bite-detection service.
 *
 * THE PARSER SEAM. The DX-CP27-G's advertising payload layout is not known: the
 * vendor app displays ~1e-38 mg, which is raw bytes reinterpreted as IEEE-754
 * float32, so its parser cannot be copied. The true layout must be determined
 * empirically (see the BLE sniffer in admin). Everything downstream therefore
 * depends only on AccFrameParser — when the format is finally identified, one
 * implementation of one method changes and nothing else moves.
 */

/** Milli-g. Integer because the sensor reports counts, not physical reals. */
export interface AccSample {
  /**
   * MONOTONIC milliseconds at packet arrival — never wall time.
   *
   * Load-bearing. Every feature in this service is a rate: Δθ/Δt, an EMA over
   * elapsed time, a dwell, a 5 s loss timeout. A wall-clock adjustment (NTP, DST,
   * the user changing the clock) mid-session would silently corrupt all of them,
   * including the 150 ms guard that the whole fish/wave discriminator rests on.
   */
  tMonotonicMs: number;
  xMg: number;
  yMg: number;
  zMg: number;
  /** Advertising RSSI, logged for diagnostics; not used by detection. */
  rssi: number;
}

/**
 * Decode one advertising payload into a sample.
 *
 * @returns null when the payload is not a well-formed ACC frame. Never throws:
 *   these bytes come off the air from whatever is in range, so malformed input
 *   is an expected condition rather than an exceptional one.
 */
export interface AccFrameParser {
  /** Short identifier for logs and the debug screen, e.g. "cp27-g/v1". */
  readonly id: string;
  parse(payload: Uint8Array, arrivalMonotonicMs: number, rssi: number): AccSample | null;
}

/** Milli-g magnitude of a sample. */
export function magnitudeMg(s: AccSample): number {
  return Math.sqrt(s.xMg * s.xMg + s.yMg * s.yMg + s.zMg * s.zMg);
}

// ---------------------------------------------------------------------------
// Parser self-test
// ---------------------------------------------------------------------------

/** Expected magnitude of gravity, and the tolerance the self-test allows. */
export const GRAVITY_MG = 1000;
export const SELF_TEST_TOLERANCE_MG = 150;

export interface SelfTestResult {
  pass: boolean;
  sampleCount: number;
  /** Mean magnitude observed, mg. NaN when no samples were supplied. */
  meanMagnitudeMg: number;
  minMagnitudeMg: number;
  maxMagnitudeMg: number;
  /** Operator-facing explanation, shown in the debug screen. */
  detail: string;
}

/** Minimum samples before a self-test verdict means anything. */
const MIN_SELF_TEST_SAMPLES = 20;

/**
 * Verify a candidate parser against physics.
 *
 * A tag at rest in ANY orientation reads one gravity, so the vector magnitude
 * must be 1000 ± 150 mg. This is the only available ground truth for an unknown
 * format: it catches a wrong scale factor, a wrong width, a wrong signedness and
 * a wrong axis offset, none of which are visible by staring at hex.
 *
 * Deliberately a returned verdict rather than an assertion — it is surfaced as
 * visible pass/fail in the debug screen. A silent assertion in a release build
 * would leave a mis-parsed stream feeding the detector, which produces confident
 * nonsense rather than an obvious failure.
 */
export function runParserSelfTest(samples: readonly AccSample[]): SelfTestResult {
  if (samples.length === 0) {
    return {
      pass: false,
      sampleCount: 0,
      meanMagnitudeMg: NaN,
      minMagnitudeMg: NaN,
      maxMagnitudeMg: NaN,
      detail: 'No samples. Is the tag advertising, and is the MAC filter right?',
    };
  }

  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const s of samples) {
    const m = magnitudeMg(s);
    sum += m;
    if (m < min) min = m;
    if (m > max) max = m;
  }
  const mean = sum / samples.length;

  if (samples.length < MIN_SELF_TEST_SAMPLES) {
    return {
      pass: false,
      sampleCount: samples.length,
      meanMagnitudeMg: mean,
      minMagnitudeMg: min,
      maxMagnitudeMg: max,
      detail: `Only ${samples.length} samples; need ${MIN_SELF_TEST_SAMPLES} for a verdict.`,
    };
  }

  const low = GRAVITY_MG - SELF_TEST_TOLERANCE_MG;
  const high = GRAVITY_MG + SELF_TEST_TOLERANCE_MG;
  const pass = mean >= low && mean <= high;

  return {
    pass,
    sampleCount: samples.length,
    meanMagnitudeMg: mean,
    minMagnitudeMg: min,
    maxMagnitudeMg: max,
    detail: pass
      ? `Mean ${mean.toFixed(0)} mg — within ${low}–${high} mg. Parser looks correct.`
      : `Mean ${mean.toFixed(0)} mg, expected ${low}–${high} mg. The parser is wrong: ` +
        `check scale (counts per g), width, signedness and axis offsets.`,
  };
}

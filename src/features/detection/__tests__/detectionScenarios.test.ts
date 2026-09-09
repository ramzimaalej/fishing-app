/**
 * The scenario suite from the spec.
 *
 * Every stream has irregular spacing and most drop packets — the medium is
 * non-connectable advertising with no retries, and uniformly-spaced test data
 * would pass while hiding the failures that matter.
 */

import type { AccSample } from '../accSample';
import { timingsFor } from '../adaptiveTiming';
import { DetectionEngine } from '../detectionEngine';
import {
  ARMING_DURATION_MS,
  ARMING_MIN_SPAN_MS,
  ALERT_MAX_MS,
  DEFAULT_DETECTION_PARAMS,
  IMPACT_DEVIATION_MG,
  REBASELINE_STILL_MS,
  EXPECTED_SAMPLE_INTERVAL_MS,
  MAX_DT_FOR_RATE_MS,
  BOOTSTRAP_INTERVAL_MS,
  TIMING_WINDOWS,
} from '../detectionParams';
import { RodDetector } from '../rodDetector';
import { alerted, runSession } from '../testkit/runSession';
import {
  constantAngle,
  drift,
  generateStream,
  pulses,
  step,
  triangleWave,
} from '../testkit/syntheticStream';

describe('steady baseline', () => {
  it('does not alert', () => {
    const stream = generateStream({
      durationMs: 60_000,
      angleAt: constantAngle(0),
      dropRate: 0.05,
      seed: 11,
    });
    expect(alerted(runSession(stream))).toBe(false);
  });

  it('does not alert on small noise below threshold', () => {
    const stream = generateStream({
      durationMs: 60_000,
      angleAt: (t) => 3 * Math.sin(t / 700),
      dropRate: 0.05,
      seed: 12,
    });
    expect(alerted(runSession(stream))).toBe(false);
  });
});

describe('slow drift (tide)', () => {
  it('does not alert, and the baseline tracks the drift', () => {
    // 18° over five minutes. Far past the 9° threshold in absolute terms, so if
    // the baseline did not follow it this would alert within a minute.
    const stream = generateStream({
      durationMs: 5 * 60_000,
      angleAt: drift(18, 5 * 60_000),
      dropRate: 0.05,
      seed: 13,
    });
    const result = runSession(stream);

    expect(alerted(result)).toBe(false);
    // θ stays small throughout precisely because the baseline is tracking.
    const maxTheta = Math.max(...result.frames.map((f) => f.thetaDeg));
    expect(maxTheta).toBeLessThan(DEFAULT_DETECTION_PARAMS.thetaDeg);
  });
});

describe('swell', () => {
  // 0.5 Hz in θ terms: a 2 s rising edge and a 2 s fall, rocking both ways so
  // the mean vector stays on baseline as real swell does.
  const swell = () =>
    generateStream({
      durationMs: 60_000,
      angleAt: triangleWave({ amplitudeDeg: 12, rampMs: 2000, alternate: true }),
      dropRate: 0.05,
      seed: 14,
    });

  it('does not alert on a gradual 2 s ramp to 12°', () => {
    const result = runSession(swell());
    expect(alerted(result)).toBe(false);
  });

  it('actually reaches the threshold, so the test above is not vacuous', () => {
    // Without this, "no alert" could simply mean the stream never deflected.
    const result = runSession(swell());
    expect(Math.max(...result.frames.map((f) => f.thetaDeg))).toBeGreaterThan(
      DEFAULT_DETECTION_PARAMS.thetaDeg,
    );
    expect(result.frames.some((f) => f.crossedUp)).toBe(true);
    expect(Math.max(...result.frames.map((f) => f.crossings))).toBeGreaterThanOrEqual(
      DEFAULT_DETECTION_PARAMS.crossingsN,
    );
  });

  it('classifies no wave crossing as fish-like', () => {
    // 12° over a 2000 ms ramp is ~6°/s against a 25°/s threshold. This is the
    // discriminator earning its keep — the swell reaches the crossing COUNT that
    // Path B requires, and is rejected on onset rate.
    const result = runSession(swell());
    expect(result.frames.some((f) => f.sharpCrossings > 0)).toBe(false);
  });

  it('does not alert when three consecutive packets drop on a rising edge', () => {
    // THE Δt GUARD. Three packets lost on a gradual ramp put ~400 ms between the
    // surviving samples; without the guard their difference reads as a single
    // large jump and manufactures a fish-like onset rate on the one feature the
    // whole discriminator rests on.
    const dropWindows = [];
    for (let cycle = 0; cycle < 15; cycle += 1) {
      const rampStart = cycle * 4000 + 800;
      dropWindows.push({ fromMs: rampStart, toMs: rampStart + 320 });
    }

    const stream = generateStream({
      durationMs: 60_000,
      angleAt: triangleWave({ amplitudeDeg: 12, rampMs: 2000, alternate: true }),
      dropWindows,
      seed: 15,
    });

    const result = runSession(stream);
    expect(alerted(result)).toBe(false);
    // And specifically: no crossing was credited with a fish-like onset.
    expect(result.frames.some((f) => f.sharpCrossings > 0)).toBe(false);
  });

  it('does contain the wide pairs the guard is meant to reject', () => {
    // Non-vacuity for the test above: if the drops had not landed on the ramps,
    // it would prove nothing.
    const dropWindows = [];
    for (let c = 0; c < 15; c += 1) {
      dropWindows.push({ fromMs: c * 4000 + 800, toMs: c * 4000 + 1120 });
    }
    const result = runSession(
      generateStream({
        durationMs: 60_000,
        angleAt: triangleWave({ amplitudeDeg: 12, rampMs: 2000, alternate: true }),
        dropWindows,
        seed: 15,
      }),
    );
    const wide = result.frames.filter((f) => (f.dtMs ?? 0) > MAX_DT_FOR_RATE_MS);
    expect(wide.length).toBeGreaterThan(10);
  });

  it('would read a gap as a fish-like onset if the rate assumed a fixed interval', () => {
    // Pins the actual failure mode. Across these gaps the rod has moved ~7°. A
    // detector that divided by the NOMINAL 100 ms advertising interval — the
    // natural mistake, since that is what the device is configured to — would
    // compute ~70°/s and call a wave a fish. Dividing by measured elapsed time
    // gives ~14°/s, and the Δt guard discards the pair regardless.
    const dropWindows = [];
    for (let c = 0; c < 15; c += 1) {
      dropWindows.push({ fromMs: c * 4000 + 800, toMs: c * 4000 + 1120 });
    }
    const result = runSession(
      generateStream({
        durationMs: 60_000,
        angleAt: triangleWave({ amplitudeDeg: 12, rampMs: 2000, alternate: true }),
        dropWindows,
        seed: 15,
      }),
    );

    const wide = result.frames.filter((f) => (f.dtMs ?? 0) > MAX_DT_FOR_RATE_MS);
    const naiveRate = (wide[0]!.thetaDeg / 100) * 1000;
    expect(naiveRate).toBeGreaterThan(DEFAULT_DETECTION_PARAMS.onsetRateMinDegPerS);
    // The shipped path reaches the opposite conclusion.
    expect(result.frames.some((f) => f.sharpCrossings > 0)).toBe(false);
  });
});

describe('sustained load — Path A', () => {
  it('alerts on a step to 15° held for 4 s', () => {
    const stream = generateStream({
      durationMs: 20_000,
      angleAt: step(5000, 15),
      dropRate: 0.05,
      seed: 16,
    });
    const result = runSession(stream);

    expect(alerted(result)).toBe(true);
    expect(result.alerts[0]!.path).toBe('A');
  });

  it('still alerts when a 1 s packet gap falls in the middle of the dwell', () => {
    // A missing packet is not evidence of a return to baseline. Breaking the
    // dwell here would drop exactly the fish that is pulling hardest.
    const stream = generateStream({
      durationMs: 20_000,
      angleAt: step(5000, 15),
      dropWindows: [{ fromMs: 6000, toMs: 7000 }],
      seed: 17,
    });
    const result = runSession(stream);

    expect(alerted(result)).toBe(true);
    expect(result.alerts[0]!.path).toBe('A');
  });

  it('alerts on a slack-line bite deflecting the opposite way', () => {
    // Direction-agnosticism. A fish swimming toward shore unloads the rod; the
    // angular deviation is identical and must be treated identically.
    const stream = generateStream({
      durationMs: 20_000,
      angleAt: step(5000, -15),
      dropRate: 0.05,
      seed: 18,
    });
    const result = runSession(stream);

    expect(alerted(result)).toBe(true);
    expect(result.alerts[0]!.path).toBe('A');
  });

  it('treats both directions identically', () => {
    const opts = { durationMs: 20_000, dropRate: 0.05, seed: 19 };
    const up = runSession(generateStream({ ...opts, angleAt: step(5000, 15) }));
    const down = runSession(generateStream({ ...opts, angleAt: step(5000, -15) }));
    expect(up.alerts.length).toBe(down.alerts.length);
    expect(up.alerts[0]!.path).toBe(down.alerts[0]!.path);
  });
});

describe('repeated sharp deflection — Path B', () => {
  it('alerts on four sharp onsets with a sustained offset', () => {
    // 200 ms leading edges (≈45°/s) on a 5° DC offset: a hooked fish thrashing
    // while still holding line tension.
    const specs = [0, 1500, 3000, 4500].map((atMs) => ({
      atMs,
      riseMs: 200,
      holdMs: 200,
      fallMs: 500,
      peakDeg: 14,
    }));

    const stream = generateStream({
      durationMs: 8000,
      angleAt: pulses(specs, 5),
      dropRate: 0.02,
      seed: 20,
    });
    const result = runSession(stream);

    expect(alerted(result)).toBe(true);
    expect(result.alerts[0]!.path).toBe('B');
  });

  it('does not alert on the same onsets when perfectly periodic with no offset', () => {
    // Sharp, but regular and centred on baseline — swell, not a fish. Both of
    // Path B's backstop conditions must fail: low CV and no DC offset.
    const specs = [0, 2500, 5000, 7500].map((atMs, i) => ({
      atMs,
      riseMs: 200,
      holdMs: 200,
      fallMs: 500,
      peakDeg: 14,
      sign: (i % 2 === 0 ? 1 : -1) as 1 | -1,
    }));

    const stream = generateStream({
      durationMs: 11_000,
      angleAt: pulses(specs, 0),
      jitterMs: 8,
      seed: 21,
    });
    const result = runSession(stream);
    expect(alerted(result)).toBe(false);

    // Non-vacuity, and proof of WHICH condition vetoed. The count conditions are
    // fully met here — sharp onsets, enough of them — so Path B is being stopped
    // solely by its backstop: the oscillation is regular and centred on baseline.
    const decisive = result.frames.filter(
      (f) =>
        f.crossings >= DEFAULT_DETECTION_PARAMS.crossingsN &&
        f.sharpCrossings >= DEFAULT_DETECTION_PARAMS.crossingsN - 1,
    );
    expect(decisive.length).toBeGreaterThan(0);
    for (const f of decisive) {
      expect(f.meanDeviationDeg).toBeLessThan(DEFAULT_DETECTION_PARAMS.meanDevDeg);
      expect(f.crossingIntervalCv ?? 0).toBeLessThan(DEFAULT_DETECTION_PARAMS.cvMin);
    }
  });
});

describe('events that must not alert', () => {
  it('ignores an isolated 150 ms spike to 20°', () => {
    const stream = generateStream({
      durationMs: 20_000,
      angleAt: pulses([{ atMs: 5000, riseMs: 100, holdMs: 50, fallMs: 100, peakDeg: 20 }]),
      dropRate: 0.05,
      seed: 22,
    });
    expect(alerted(runSession(stream))).toBe(false);
  });

  it('ignores a sharp return to baseline after a gradual 2 s rise', () => {
    // THE FALLING EDGE IS NOT DIAGNOSTIC. A fast-action blank recoils sharply
    // whatever caused the bend, and a fish releasing tension looks the same. If
    // any symmetric rise/fall feature existed, this would alert.
    const stream = generateStream({
      durationMs: 20_000,
      angleAt: pulses([
        { atMs: 5000, riseMs: 2000, holdMs: 100, fallMs: 100, peakDeg: 14 },
      ]),
      dropRate: 0.05,
      seed: 23,
    });
    const result = runSession(stream);

    expect(alerted(result)).toBe(false);
    expect(result.frames.some((f) => f.sharpCrossings > 0)).toBe(false);
  });
});

/**
 * The silence bar in force before any sample has arrived.
 *
 * Read from the timings rather than a constant: signal-lost is now derived from
 * the rate the tag is actually advertising at, so there is no single number to
 * assert against — only whatever the estimate currently says.
 */
const BOOTSTRAP_SIGNAL_LOST_MS = timingsFor(BOOTSTRAP_INTERVAL_MS, TIMING_WINDOWS).signalLostMs;

describe('signal loss', () => {
  // Relative to BOOTSTRAP_SIGNAL_LOST_MS rather than to a literal, because that constant
  // is derived from the tag's measured advertising interval and moves whenever a
  // tag is re-measured. Pinning the wall-clock numbers here would turn a
  // deliberate re-tune into a test failure that says nothing about behaviour.
  it('reports SIGNAL_LOST once the silence threshold passes, never "no fish"', () => {
    const engine = new DetectionEngine(DEFAULT_DETECTION_PARAMS);
    engine.arm(100_000);

    expect(engine.tick(100_000 + BOOTSTRAP_SIGNAL_LOST_MS - 1_000)).toHaveLength(0);

    const events = engine.tick(100_000 + BOOTSTRAP_SIGNAL_LOST_MS + 1_000);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('SIGNAL_LOST');
    expect(engine.isSignalLost()).toBe(true);
  });

  it('reports it only once until the stream resumes', () => {
    const engine = new DetectionEngine(DEFAULT_DETECTION_PARAMS);
    engine.arm(100_000);

    expect(engine.tick(100_000 + BOOTSTRAP_SIGNAL_LOST_MS + 1_000)).toHaveLength(1);
    expect(engine.tick(100_000 + BOOTSTRAP_SIGNAL_LOST_MS + 3_000)).toHaveLength(0);
    expect(engine.tick(100_000 + BOOTSTRAP_SIGNAL_LOST_MS + 5_000)).toHaveLength(0);
  });

  it('does not fire while idle — an unarmed rod is not being watched', () => {
    const engine = new DetectionEngine(DEFAULT_DETECTION_PARAMS);
    expect(engine.tick(200_000)).toHaveLength(0);
  });
});

describe('arming', () => {
  // This path had NO coverage: runSession constructs the extractor with a
  // perfect baseline and calls engine.arm() directly, so computeArming, the
  // ARMING→WATCHING transition and every refusal below were never exercised.
  const stillWindow = (deg = 0) =>
    generateStream({
      durationMs: ARMING_DURATION_MS + 5_000,
      angleAt: constantAngle(deg),
      seed: 31,
    });

  it('arms from a still rod and starts watching', () => {
    const detector = new RodDetector(DEFAULT_DETECTION_PARAMS);
    let phase = detector.getPhase();
    for (const s of stillWindow()) phase = detector.process(s).phase;

    expect(phase).toBe('WATCHING');
    expect(detector.getArmFailReason()).toBeNull();
  });

  it('refuses a rod that was being swung, rather than baselining the swing', () => {
    // The old coherence gate passed a ±60° sweep — nearly seven times the
    // detection threshold — and returned the mean of it as "at rest".
    const swung = generateStream({
      durationMs: ARMING_DURATION_MS + 5_000,
      angleAt: triangleWave({ amplitudeDeg: 60, rampMs: 1500, alternate: true }),
      seed: 32,
    });

    const detector = new RodDetector(DEFAULT_DETECTION_PARAMS);
    let phase = detector.getPhase();
    for (const s of swung) phase = detector.process(s).phase;

    expect(phase).toBe('ARM_FAILED');
    expect(detector.getArmFailReason()).toMatch(/moved too much/i);
  });

  it('still arms through swell, which the window exists to observe', () => {
    const swell = generateStream({
      durationMs: ARMING_DURATION_MS + 5_000,
      angleAt: triangleWave({ amplitudeDeg: 12, rampMs: 2000, alternate: true }),
      seed: 33,
    });

    const detector = new RodDetector(DEFAULT_DETECTION_PARAMS);
    let phase = detector.getPhase();
    for (const s of swell) phase = detector.process(s).phase;

    expect(phase).toBe('WATCHING');
  });

  it('discards casts and knocks rather than baselining them', () => {
    // A 4 s cast inside an otherwise still window tilted the baseline 3.75° —
    // 42% of the threshold — for the entire session.
    const withCast = generateStream({
      durationMs: ARMING_DURATION_MS + 5_000,
      angleAt: (t) => (t > 20_000 && t < 24_000 ? 70 : 0),
      magnitudeAt: (t) => (t > 20_000 && t < 24_000 ? 2800 : 1000),
      seed: 34,
    });

    const detector = new RodDetector(DEFAULT_DETECTION_PARAMS);
    for (const s of withCast) detector.process(s);
    expect(detector.getPhase()).toBe('WATCHING');

    // Baseline must be the rest attitude, so a later real load reads its true size.
    const t0 = withCast[withCast.length - 1]!.tMonotonicMs;
    const loaded = generateStream({
      durationMs: 8_000,
      angleAt: constantAngle(13),
      startMs: t0 + 100,
      seed: 35,
    });
    const thetas = loaded.map((s) => detector.process(s).frame?.thetaDeg ?? 0);
    expect(Math.max(...thetas)).toBeGreaterThan(11);
  });

  it('reports SIGNAL_LOST if the tag dies mid-arming, not "calibrating" forever', () => {
    const detector = new RodDetector(DEFAULT_DETECTION_PARAMS);
    const partial = generateStream({ durationMs: 10_000, angleAt: constantAngle(0), seed: 36 });
    for (const s of partial) detector.process(s);
    expect(detector.getPhase()).toBe('ARMING');

    // Against the detector's OWN bar, not the bootstrap one. It has just been fed
    // ten seconds of samples, so it has measured this stream and narrowed the
    // silence window to match it — which is the whole point of adapting, and
    // asserting the prior here would be asserting that it had not.
    const last = partial[partial.length - 1]!.tMonotonicMs;
    const bar = detector.getTimings().signalLostMs;
    expect(detector.tick(last + bar - 1_000)).toHaveLength(0);
    const events = detector.tick(last + bar + 1_000);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('SIGNAL_LOST');
  });
});

describe('parameters changing mid-session', () => {
  it('stands down an alarm raised under the old threshold', () => {
    // Raising the threshold used to strand the rod in ALERT_HOOKED: the reset
    // needed theta below newThreshold*0.6, which a load between the old and new
    // thresholds never reaches, so no reset and no further alerts could occur.
    const engine = new DetectionEngine(DEFAULT_DETECTION_PARAMS);
    engine.arm(100_000);
    expect(engine.getState()).toBe('ARMED');

    engine.setParams({ ...DEFAULT_DETECTION_PARAMS, thetaDeg: 20 });
    expect(engine.getState()).toBe('ARMED');
  });
});

/**
 * The rate the tag actually delivers.
 *
 * Every other scenario in this file runs at the generator's 100 ms default,
 * which is roughly what the tag advertised when the detector was written and
 * thirty-six times faster than what it sends now. Those scenarios still describe
 * the intended behaviour and are worth keeping, but they cannot show whether the
 * detector works on the hardware in hand — at 3.6 s spacing the constants, not
 * the algorithm, decide whether anything fires at all.
 */
describe('at the tag\'s measured advertising rate', () => {
  const atTagRate = (opts: Parameters<typeof generateStream>[0]) =>
    generateStream({ nominalIntervalMs: EXPECTED_SAMPLE_INTERVAL_MS, jitterMs: 300, ...opts });

  it('arms, rather than calibrating forever', () => {
    const detector = new RodDetector(DEFAULT_DETECTION_PARAMS);
    const stream = atTagRate({
      durationMs: ARMING_DURATION_MS + 10_000,
      angleAt: constantAngle(0),
      dropRate: 0.05,
      seed: 71,
    });
    for (const sample of stream) detector.process(sample);

    expect(detector.getPhase()).toBe('WATCHING');
  });

  it('does not declare the signal lost across a single dropped advertisement', () => {
    // The gap that used to be fatal. Two intervals of silence is one missed
    // advert on a healthy tag, and the old 5 s threshold reported it as a dead
    // tag — an alarm describing its own threshold rather than the hardware.
    const detector = new RodDetector(DEFAULT_DETECTION_PARAMS);
    const stream = atTagRate({
      durationMs: ARMING_DURATION_MS + 10_000,
      angleAt: constantAngle(0),
      seed: 72,
    });
    for (const sample of stream) detector.process(sample);

    const last = stream[stream.length - 1]!.tMonotonicMs;
    expect(detector.tick(last + EXPECTED_SAMPLE_INTERVAL_MS * 2.5)).toHaveLength(0);
  });

  it('still alerts on a sustained load (Path A)', () => {
    const stream = atTagRate({
      durationMs: 40_000,
      angleAt: constantAngle(14),
      dropRate: 0.05,
      seed: 73,
    });
    const result = runSession(stream);

    expect(alerted(result)).toBe(true);
    expect(result.alerts.every((a) => a.path === 'A')).toBe(true);
  });

  it('cannot reach Path B, and says so by scoring every crossing unsharp', () => {
    // Not a bug to fix by tuning — a consequence of sampling. A fish's leading
    // edge lasts 100–300 ms and lands entirely between two readings 3.6 s apart,
    // so MAX_DT_FOR_RATE_MS correctly refuses to infer a slope across the gap.
    // Asserted rather than left implicit: a dead detection path and a quiet sea
    // produce identical output, and only a test tells them apart.
    const stream = atTagRate({
      durationMs: 60_000,
      angleAt: pulses([
        { atMs: 10_000, riseMs: 200, holdMs: 400, fallMs: 400, peakDeg: 16 },
        { atMs: 20_000, riseMs: 200, holdMs: 400, fallMs: 400, peakDeg: 16 },
        { atMs: 30_000, riseMs: 200, holdMs: 400, fallMs: 400, peakDeg: 16 },
        { atMs: 40_000, riseMs: 200, holdMs: 400, fallMs: 400, peakDeg: 16 },
      ]),
      seed: 74,
    });
    const result = runSession(stream);

    expect(result.frames.every((f) => f.sharpCrossings === 0)).toBe(true);
    expect(result.alerts.some((a) => a.path === 'B')).toBe(false);
  });
});

/**
 * Arming is a deadline, not a stopwatch.
 *
 * A minute of "calibrating" is a minute of a fishing session in which nothing is
 * being watched, and a rod that has lain still since the moment it was set down
 * has already supplied everything arming needs. These pin that it finishes on
 * evidence rather than on the clock, and that finishing early still requires the
 * rod to be convincingly at rest.
 */
describe('arming finishes as soon as the rod has proved it is still', () => {
  const atTagRate = (opts: Parameters<typeof generateStream>[0]) =>
    generateStream({ nominalIntervalMs: EXPECTED_SAMPLE_INTERVAL_MS, jitterMs: 300, ...opts });

  /** Elapsed ms from the first sample to the one that started WATCHING. */
  const timeToArm = (stream: readonly AccSample[]): number | null => {
    const detector = new RodDetector(DEFAULT_DETECTION_PARAMS);
    const start = stream[0]!.tMonotonicMs;
    for (const sample of stream) {
      if (detector.process(sample).phase === 'WATCHING') {
        return sample.tMonotonicMs - start;
      }
    }
    return null;
  };

  it('arms a parked rod well inside the deadline', () => {
    const armedAt = timeToArm(
      atTagRate({
        durationMs: ARMING_DURATION_MS + 10_000,
        angleAt: constantAngle(0),
        dropRate: 0.05,
        seed: 81,
      }),
    );

    expect(armedAt).not.toBeNull();
    expect(armedAt!).toBeGreaterThanOrEqual(ARMING_MIN_SPAN_MS);
    expect(armedAt!).toBeLessThan(ARMING_DURATION_MS / 2);
  });

  it('will not take the short path on a rod that is still being handled', () => {
    // A ±15° sweep sits between the two coherence gates by construction: loose
    // enough for the full window to accept as swell, too loose to arm early on.
    // If the short path used the same gate as the deadline, this would arm in
    // fifteen seconds on the mean of a swing.
    const armedAt = timeToArm(
      atTagRate({
        durationMs: ARMING_DURATION_MS + 10_000,
        angleAt: triangleWave({ amplitudeDeg: 15, rampMs: 4_500, alternate: true }),
        seed: 82,
      }),
    );

    expect(armedAt === null || armedAt >= ARMING_DURATION_MS).toBe(true);
  });
});

/**
 * The rod put back down somewhere else.
 *
 * BASELINE_FREEZE_FACTOR stops the baseline chasing a bend, which is what keeps
 * a hooked fish from being averaged into "at rest". It also has no natural end,
 * so a rod reeled in and re-seated at a different angle used to be measured
 * against wherever it was armed for the rest of the session: 6 degrees off held
 * 6.0 degrees for six simulated minutes, and 12 degrees off held 12.0 and raised
 * a bite alert on an empty hook.
 */
describe('a rod re-seated after a cast', () => {
  const atTagRate = (opts: Parameters<typeof generateStream>[0]) =>
    generateStream({ nominalIntervalMs: EXPECTED_SAMPLE_INTERVAL_MS, jitterMs: 300, ...opts });

  /** An armed detector, and the time to start the next stream at. */
  const armedRod = (seed: number) => {
    const detector = new RodDetector(DEFAULT_DETECTION_PARAMS);
    const stream = atTagRate({ durationMs: 40_000, angleAt: constantAngle(0), seed });
    for (const sample of stream) detector.process(sample);
    expect(detector.getPhase()).toBe('WATCHING');
    return { detector, from: stream[stream.length - 1]!.tMonotonicMs + 4_000 };
  };

  it('adopts the new rest attitude instead of reading it as a permanent load', () => {
    const { detector, from } = armedRod(5);
    const after = atTagRate({
      durationMs: 4 * 60_000,
      angleAt: constantAngle(12),
      startMs: from,
      seed: 6,
    });

    let theta = 0;
    let rebaselinedAt: number | null = null;
    for (const sample of after) {
      const tick = detector.process(sample);
      theta = tick.frame?.thetaDeg ?? theta;
      if (tick.frame?.rebaselined && rebaselinedAt === null) {
        rebaselinedAt = sample.tMonotonicMs - from;
      }
    }

    expect(rebaselinedAt).not.toBeNull();
    // Promptly after the stillness requirement, not eventually.
    expect(rebaselinedAt!).toBeLessThan(REBASELINE_STILL_MS * 1.5);
    // And the rod now reads at rest, rather than permanently 12 degrees loaded.
    expect(theta).toBeLessThan(1);
  });

  it('never does it to a load that is still moving', () => {
    // THE failure that matters. A load that holds while changing is precisely
    // what Path A calls a fish, so adopting it as "at rest" would erase a fish
    // that is on and silence an alert that has already been raised. Swept across
    // oscillation periods because at this sample rate some of them alias toward
    // DC, which is exactly when a stillness test is most likely to be fooled.
    for (const rampMs of [1_500, 3_000, 4_500, 6_000, 9_000, 12_000, 20_000]) {
      const { detector, from } = armedRod(7);
      const fish = atTagRate({
        durationMs: 3 * 60_000,
        startMs: from,
        seed: 8,
        angleAt: triangleWave({ amplitudeDeg: 20, rampMs, offsetDeg: 11 }),
      });

      const rebaselines = fish.filter((s) => detector.process(s).frame?.rebaselined).length;
      expect(rebaselines).toBe(0);
    }
  });

  it('starts the clock over whenever the rod is knocked', () => {
    // A rod being handled is not a rod at rest, however deflected it looks. The
    // impact clears the window, so a rod knocked every half minute can never
    // accumulate the undisturbed stretch a re-baseline requires.
    const { detector, from } = armedRod(9);
    const handled = atTagRate({
      durationMs: 4 * 60_000,
      angleAt: constantAngle(12),
      startMs: from,
      seed: 10,
      magnitudeAt: (t) => (Math.floor(t / 30_000) % 2 === 0 ? 1000 : 1000 + IMPACT_DEVIATION_MG * 2),
    });

    const rebaselines = handled.filter((s) => detector.process(s).frame?.rebaselined).length;
    expect(rebaselines).toBe(0);
  });
});

describe('a tag that is never heard at all', () => {
  it('says so, instead of calibrating for ever', () => {
    // The reported symptom: "calibrating is taking an eternity". Arming cannot
    // finish without samples, and tick() used to return early whenever no packet
    // had EVER arrived — so a rod bound to a tag that was off, out of range, or
    // simply the wrong tag sat on "Calibrating" indefinitely and explained
    // nothing. Silence has to be measurable from when watching began.
    const detector = new RodDetector(DEFAULT_DETECTION_PARAMS);

    expect(detector.tick(100_000)).toHaveLength(0);
    expect(detector.tick(100_000 + BOOTSTRAP_SIGNAL_LOST_MS - 1_000)).toHaveLength(0);

    const events = detector.tick(100_000 + BOOTSTRAP_SIGNAL_LOST_MS + 1_000);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('SIGNAL_LOST');
    // Named distinctly, because the fix differs: a tag that went quiet has moved
    // or run flat; one never heard is off, away, or not the tag this rod holds.
    expect(events[0]!.reason).toMatch(/Nothing heard/i);
    expect(detector.getPhase()).toBe('ARMING');
  });

  it('recovers silently when the tag finally speaks', () => {
    // A motion-woken tag is quiet until it is moved, so reporting silence must
    // not be a terminal state.
    const detector = new RodDetector(DEFAULT_DETECTION_PARAMS);
    expect(detector.tick(100_000)).toHaveLength(0);
    expect(detector.tick(100_000 + BOOTSTRAP_SIGNAL_LOST_MS + 1_000)).toHaveLength(1);

    const stream = generateStream({
      nominalIntervalMs: EXPECTED_SAMPLE_INTERVAL_MS,
      jitterMs: 300,
      durationMs: ARMING_DURATION_MS + 10_000,
      angleAt: constantAngle(0),
      startMs: 200_000,
      seed: 91,
    });
    for (const sample of stream) detector.process(sample);

    expect(detector.getPhase()).toBe('WATCHING');
  });
});

/**
 * Both rates the tag was actually measured at, on one phone, 30 s apart.
 *
 * 7.3 Hz while being handled and 0.43 Hz while left alone — the CP27 advertises
 * fast when it moves and slowly when it does not. A detector tuned to either one
 * is wrong for the other, and arming happens at the slow rate while a bite
 * happens at the fast one, so it has to work at both within a single session.
 */
describe('at both rates the tag really runs at', () => {
  const ACTIVE_MS = 137;
  const IDLE_MS = 2_300;

  const armedAt = (intervalMs: number) => {
    const detector = new RodDetector(DEFAULT_DETECTION_PARAMS);
    const stream = generateStream({
      nominalIntervalMs: intervalMs,
      jitterMs: intervalMs * 0.1,
      durationMs: 70_000,
      angleAt: constantAngle(0),
      dropRate: 0.05,
      seed: 3,
    });
    for (const sample of stream) detector.process(sample);
    expect(detector.getPhase()).toBe('WATCHING');
    return { detector, from: stream[stream.length - 1]!.tMonotonicMs + 200 };
  };

  const pathsFor = (detector: RodDetector, stream: ReturnType<typeof generateStream>) => {
    const paths = new Set<string>();
    for (const sample of stream) {
      for (const event of detector.process(sample).events) {
        if (event.type === 'ALERT_HOOKED' && event.path) paths.add(event.path);
      }
    }
    return paths;
  };

  it.each([
    ['active', ACTIVE_MS],
    ['idle', IDLE_MS],
  ])('alerts on a sustained load at the %s rate', (_label, intervalMs) => {
    const { detector, from } = armedAt(intervalMs);
    const held = generateStream({
      nominalIntervalMs: intervalMs,
      jitterMs: intervalMs * 0.1,
      durationMs: 20_000,
      startMs: from,
      seed: 4,
      angleAt: constantAngle(14),
    });

    expect(pathsFor(detector, held).has('A')).toBe(true);
  });

  it('reaches Path B once the tag is fast enough to show a leading edge', () => {
    // This was documented as permanently impossible on this hardware. It was
    // only ever impossible at a rate measured through a scanner discarding nine
    // advertisements in ten — the tag can resolve a fish's onset perfectly well.
    const { detector, from } = armedAt(ACTIVE_MS);
    const strikes = generateStream({
      nominalIntervalMs: ACTIVE_MS,
      jitterMs: ACTIVE_MS * 0.1,
      durationMs: 30_000,
      startMs: from,
      seed: 5,
      angleAt: pulses(
        [1_000, 3_000, 5_000, 7_000].map((atMs) => ({
          atMs,
          riseMs: 150,
          holdMs: 200,
          fallMs: 300,
          peakDeg: 17,
        })),
        5,
      ),
    });

    expect(pathsFor(detector, strikes).has('B')).toBe(true);
    expect(detector.getTimings().pathBAvailable).toBe(true);
  });

  it('still refuses Path B at the idle rate, where no onset was sampled', () => {
    const { detector, from } = armedAt(IDLE_MS);
    const strikes = generateStream({
      nominalIntervalMs: IDLE_MS,
      jitterMs: IDLE_MS * 0.1,
      durationMs: 60_000,
      startMs: from,
      seed: 6,
      angleAt: pulses(
        [2_000, 8_000, 14_000, 20_000].map((atMs) => ({
          atMs,
          riseMs: 150,
          holdMs: 200,
          fallMs: 300,
          peakDeg: 17,
        })),
        5,
      ),
    });

    expect(pathsFor(detector, strikes).has('B')).toBe(false);
    expect(detector.getTimings().pathBAvailable).toBe(false);
  });
});

/**
 * A rod must never go deaf after one bite.
 *
 * ALERT_HOOKED had a single exit — theta falling below the reset factor and
 * holding — and that exit disappears when the rod's rest attitude shifts during
 * the fight and the baseline cannot catch up. Reproduced two ways, both ordinary
 * on water: a rod resting off-centre in swell wider than the re-baseline spread
 * gate, and a rod knocked often enough to keep clearing the settle window.
 * Neither ever alerted again for the rest of the session, and nothing said so.
 */
describe('a second bite after the first', () => {
  const INT = 137;

  const armedRod = () => {
    const detector = new RodDetector(DEFAULT_DETECTION_PARAMS);
    const stream = generateStream({
      nominalIntervalMs: INT,
      jitterMs: 14,
      durationMs: 70_000,
      angleAt: constantAngle(0),
      dropRate: 0.05,
      seed: 3,
    });
    for (const sample of stream) detector.process(sample);
    expect(detector.getPhase()).toBe('WATCHING');
    return { detector, from: stream[stream.length - 1]!.tMonotonicMs + 200 };
  };

  /** Feed a stream, returning the event types seen. */
  const feed = (detector: RodDetector, stream: ReturnType<typeof generateStream>) => {
    const seen = new Set<string>();
    for (const sample of stream) {
      for (const event of detector.process(sample).events) seen.add(event.type);
    }
    return seen;
  };

  const bite = (from: number, deg: number) =>
    generateStream({
      nominalIntervalMs: INT,
      jitterMs: 14,
      durationMs: 25_000,
      startMs: from,
      seed: 7,
      angleAt: constantAngle(deg),
    });

  it('still resets the normal way, long before the bound', () => {
    // The bound is a backstop, not the mechanism. A rod that does return to rest
    // must reset on the hysteresis, or every bite would hold the alarm for three
    // minutes.
    const { detector, from } = armedRod();
    feed(detector, bite(from, 14));

    const rest = generateStream({
      nominalIntervalMs: INT,
      jitterMs: 14,
      durationMs: 30_000,
      startMs: from + 25_200,
      seed: 8,
      angleAt: constantAngle(0),
    });

    expect(30_000).toBeLessThan(ALERT_MAX_MS);
    expect(feed(detector, rest).has('RESET_TO_ARMED')).toBe(true);
  });

  it('recovers when the rod rests off-centre in swell the re-baseline cannot read', () => {
    // The reproduction. Swell wider than REBASELINE_SPREAD_DEG keeps the ordinary
    // re-baseline from ever firing, and an off-centre rest keeps theta above the
    // reset factor, so the alert had no exit at all.
    //
    // Only this scenario is covered, deliberately. A knocked-rod variant was
    // tried and dropped: its settle clock had been running since before the
    // bite, so it recovered through the NORMAL re-baseline and passed whether
    // the bound existed or not — coverage in appearance only.
    const REST_DEG = 6;
    const { detector, from } = armedRod();
    feed(detector, bite(from, 14));

    const after = generateStream({
      nominalIntervalMs: INT,
      jitterMs: 14,
      durationMs: ALERT_MAX_MS + 60_000,
      startMs: from + 25_200,
      seed: 8,
      angleAt: triangleWave({ amplitudeDeg: 8, rampMs: 3_000, offsetDeg: REST_DEG }),
    });
    expect(feed(detector, after).has('RESET_TO_ARMED')).toBe(true);

    // And genuinely watching again, not merely un-latched.
    const later = after[after.length - 1]!.tMonotonicMs + 200;
    expect(feed(detector, bite(later, REST_DEG + 15)).has('ALERT_HOOKED')).toBe(true);
  });
});

/**
 * Rate CHANGES, not merely rates.
 *
 * Every other scenario holds the interval constant, and that is what hid this:
 * the tag advertises fast whenever the rod MOVES — wind, chop, a cast, someone
 * walking past — and drops back to its idle rate when the rod settles. The
 * detector therefore meets a falling rate constantly, right at the moment a rod
 * has just been set down and a fish is most likely to take.
 */
describe('when the tag changes rate mid-session', () => {
  const IDLE = 2_300;
  const FAST = 137;

  /** An armed rod at the idle rate, and the time to continue from. */
  const armedAtIdle = () => {
    const detector = new RodDetector(DEFAULT_DETECTION_PARAMS);
    const stream = generateStream({
      nominalIntervalMs: IDLE,
      jitterMs: 200,
      durationMs: 90_000,
      angleAt: constantAngle(0),
      seed: 3,
    });
    for (const sample of stream) detector.process(sample);
    expect(detector.getPhase()).toBe('WATCHING');
    return { detector, from: stream[stream.length - 1]!.tMonotonicMs + 500 };
  };

  /** Chop shaking the rod: the tag speeds up, the ATTITUDE stays at rest. */
  const fastBurst = (from: number) =>
    generateStream({
      nominalIntervalMs: FAST,
      jitterMs: 14,
      durationMs: 10_000,
      startMs: from,
      seed: 4,
      angleAt: (rel) => 1.5 * Math.sin(rel / 300),
    });

  const sustainedBite = (from: number) =>
    generateStream({
      nominalIntervalMs: IDLE,
      jitterMs: 200,
      durationMs: 40_000,
      startMs: from,
      seed: 5,
      angleAt: constantAngle(14),
    });

  const firstAlertMs = (detector: RodDetector, stream: ReturnType<typeof generateStream>) => {
    const start = stream[0]!.tMonotonicMs;
    for (const sample of stream) {
      for (const event of detector.process(sample).events) {
        if (event.type === 'ALERT_HOOKED') return sample.tMonotonicMs - start;
      }
    }
    return null;
  };

  it('alerts on a bite just as fast after the rate has fallen back', () => {
    // The rate estimate is a median, so it cannot fall until half its window
    // has — about 25 s at the idle rate. Deriving the dwell gap tolerance from
    // that stale estimate gave 400 ms against a real 2300 ms interval, which
    // broke the dwell on EVERY sample and made Path A — the only path reachable
    // at this rate — silently unable to fire. Measured before the fix: 4.8 s
    // without a burst, 27.9 s with one, and a 25 s bite missed outright.
    const control = armedAtIdle();
    const baseline = firstAlertMs(control.detector, sustainedBite(control.from));

    const disturbed = armedAtIdle();
    for (const sample of fastBurst(disturbed.from)) disturbed.detector.process(sample);
    const afterBurst = firstAlertMs(disturbed.detector, sustainedBite(disturbed.from + 10_500));

    expect(baseline).not.toBeNull();
    expect(afterBurst).not.toBeNull();
    // Not merely "eventually": no worse than one extra reading.
    expect(afterBurst!).toBeLessThanOrEqual(baseline! + IDLE);
  });

  it('does not cry signal-lost on a healthy tag that has just slowed down', () => {
    // Same stale estimate, other symptom: a 2500 ms silence bar against a
    // 2300 ms interval, so one dropped advertisement reported a dead tag. The
    // spec calls SIGNAL_LOST the most important state here and requires it be
    // both seen and heard, which is exactly why it must not be spent on a rod
    // that is working.
    const { detector, from } = armedAtIdle();
    for (const sample of fastBurst(from)) detector.process(sample);

    const patchy = generateStream({
      nominalIntervalMs: IDLE,
      jitterMs: 200,
      durationMs: 60_000,
      startMs: from + 10_500,
      seed: 9,
      angleAt: constantAngle(0),
      dropRate: 0.25,
    });

    const lost = patchy.filter((sample) =>
      detector.process(sample).events.some((e) => e.type === 'SIGNAL_LOST'),
    );
    expect(lost).toHaveLength(0);
  });
});

describe('a rod carried to the water before it is set down', () => {
  it('arms once it has been still, not on how it was carried', () => {
    // The ordinary flow: open the app, walk to the swim, cast, set the rod down
    // — all inside the arming window. The window was cumulative and never
    // trimmed, so that handling was still being judged a minute later: twenty
    // seconds of carrying outvoted sixty seconds of the rod lying perfectly
    // still, and arming latched ARM_FAILED. The ordinary flow could not arm.
    const detector = new RodDetector(DEFAULT_DETECTION_PARAMS);

    const carried = generateStream({
      nominalIntervalMs: 137,
      jitterMs: 14,
      durationMs: 20_000,
      angleAt: triangleWave({ amplitudeDeg: 60, rampMs: 1_500, alternate: true }),
      seed: 6,
    });
    for (const sample of carried) detector.process(sample);

    const setDown = carried[carried.length - 1]!.tMonotonicMs + 200;
    const parked = generateStream({
      nominalIntervalMs: 137,
      jitterMs: 14,
      durationMs: 60_000,
      startMs: setDown,
      angleAt: constantAngle(0),
      seed: 7,
    });

    let armedAfterMs: number | null = null;
    for (const sample of parked) {
      if (detector.process(sample).phase === 'WATCHING' && armedAfterMs === null) {
        armedAfterMs = sample.tMonotonicMs - setDown;
      }
    }

    expect(detector.getPhase()).toBe('WATCHING');
    // Promptly after being set down, on the short path — not after waiting out
    // the deadline for the handling to age out of a cumulative window.
    expect(armedAfterMs).not.toBeNull();
    expect(armedAfterMs!).toBeLessThan(ARMING_DURATION_MS / 2);
  });
});

/**
 * Readings that are acceleration, not attitude.
 *
 * isImpact is the extractor's own statement that a reading's DIRECTION cannot be
 * believed — computeArming drops such samples, updateBaseline refuses them, and
 * trackResettle clears its window on them. The alert paths did not: theta, the
 * dwell and the crossing counter were all computed from impact vectors, so a
 * knocked rod raised a bite alert.
 *
 * The rule is UNKNOWN rather than quiet, and it is asymmetric. An impact cannot
 * start a dwell, because it says nothing about where the rod points. It must not
 * break one either, or a fish running hard enough to shake the rod would cancel
 * the very dwell its run created.
 */
describe('impacts are not attitudes', () => {
  const INT = 137;
  const KNOCK_AT = [2_000, 5_000, 8_000, 11_000];

  const armedRod = () => {
    const detector = new RodDetector(DEFAULT_DETECTION_PARAMS);
    const stream = generateStream({
      nominalIntervalMs: INT,
      jitterMs: 14,
      durationMs: 70_000,
      angleAt: constantAngle(0),
      dropRate: 0.05,
      seed: 3,
    });
    for (const sample of stream) detector.process(sample);
    expect(detector.getPhase()).toBe('WATCHING');
    return { detector, from: stream[stream.length - 1]!.tMonotonicMs + 200 };
  };

  const alertPaths = (detector: RodDetector, stream: ReturnType<typeof generateStream>) => {
    const paths = new Set<string>();
    for (const sample of stream) {
      for (const event of detector.process(sample).events) {
        if (event.type === 'ALERT_HOOKED' && event.path) paths.add(event.path);
      }
    }
    return paths;
  };

  it('does not alert on a rod that is being knocked', () => {
    // A tripod bumped, wind slapping the blank, weed hitting the line. Four
    // sharp deflections whose readings are three times the impact threshold —
    // raised a Path B alert before this.
    const { detector, from } = armedRod();
    const knocked = generateStream({
      nominalIntervalMs: INT,
      jitterMs: 14,
      durationMs: 20_000,
      startMs: from,
      seed: 4,
      angleAt: pulses(
        KNOCK_AT.map((atMs) => ({ atMs, riseMs: 150, holdMs: 200, fallMs: 300, peakDeg: 20 })),
        0,
      ),
      magnitudeAt: (rel) =>
        KNOCK_AT.some((at) => rel >= at && rel <= at + 650)
          ? 1000 + IMPACT_DEVIATION_MG * 3
          : 1000,
    });

    expect(alertPaths(detector, knocked).size).toBe(0);
  });

  it('does not alert on a rod being shaken, however far it appears to bend', () => {
    // Every reading is acceleration, so the 13 degrees is not a bend at all.
    // Raised a Path A alert before this.
    const { detector, from } = armedRod();
    const shaken = generateStream({
      nominalIntervalMs: INT,
      jitterMs: 14,
      durationMs: 20_000,
      startMs: from,
      seed: 5,
      angleAt: constantAngle(13),
      magnitudeAt: () => 1700,
    });

    expect(alertPaths(detector, shaken).size).toBe(0);
  });

  it('still alerts on a violent run, where a real load carries impacts', () => {
    // THE case that stops this being a blanket suppression. A quarter of the
    // readings are impacts because the fish is accelerating the rod; the rest
    // show a genuine sustained 15 degree load. Suppressing impacts outright
    // silenced this, which would lose the most certain fish the detector sees.
    const { detector, from } = armedRod();
    const run = generateStream({
      nominalIntervalMs: INT,
      jitterMs: 14,
      durationMs: 25_000,
      startMs: from,
      seed: 7,
      angleAt: constantAngle(15),
      magnitudeAt: (rel) =>
        Math.floor(rel / 400) % 4 === 0 ? 1000 + IMPACT_DEVIATION_MG * 2 : 1000,
    });

    expect(alertPaths(detector, run).has('A')).toBe(true);
  });

  it('keeps impact readings out of the window that defines "at rest"', () => {
    // The sliding window feeds meanDeviationDeg AND forceRebaseline, which is
    // the mechanism that adopts an attitude as the new rest position. Letting
    // impact vectors into it means a rod being knocked can define where "at
    // rest" is — from readings that are mostly acceleration.
    //
    // Every reading here is either the rod at rest, or an impact pointing 40
    // degrees away. If impacts counted, the window mean would be dragged well
    // off zero.
    const { detector, from } = armedRod();
    const knocking = (rel: number) => Math.floor(rel / 500) % 3 === 0;

    const stream = generateStream({
      nominalIntervalMs: INT,
      jitterMs: 14,
      durationMs: 30_000,
      startMs: from,
      seed: 11,
      angleAt: (rel) => (knocking(rel) ? 40 : 0),
      magnitudeAt: (rel) => (knocking(rel) ? 1800 : 1000),
    });

    let worst = 0;
    for (const sample of stream) {
      const frame = detector.process(sample).frame;
      if (frame) worst = Math.max(worst, frame.meanDeviationDeg);
    }

    // Well under the 4 degree meanDevDeg that supports a Path B alert.
    expect(worst).toBeLessThan(2);
  });

  it('still alerts on an ordinary sustained load', () => {
    const { detector, from } = armedRod();
    const held = generateStream({
      nominalIntervalMs: INT,
      jitterMs: 14,
      durationMs: 20_000,
      startMs: from,
      seed: 6,
      angleAt: constantAngle(14),
    });

    expect(alertPaths(detector, held).has('A')).toBe(true);
  });
});


/**
 * The scenario suite from the spec.
 *
 * Every stream has irregular spacing and most drop packets — the medium is
 * non-connectable advertising with no retries, and uniformly-spaced test data
 * would pass while hiding the failures that matter.
 */

import { DetectionEngine } from '../detectionEngine';
import { DEFAULT_DETECTION_PARAMS, MAX_DT_FOR_RATE_MS } from '../detectionParams';
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

describe('signal loss', () => {
  it('reports SIGNAL_LOST after 6 s of silence, never "no fish"', () => {
    const engine = new DetectionEngine(DEFAULT_DETECTION_PARAMS);
    engine.arm(100_000);

    expect(engine.tick(104_000)).toHaveLength(0);

    const events = engine.tick(106_000);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('SIGNAL_LOST');
    expect(engine.isSignalLost()).toBe(true);
  });

  it('reports it only once until the stream resumes', () => {
    const engine = new DetectionEngine(DEFAULT_DETECTION_PARAMS);
    engine.arm(100_000);

    expect(engine.tick(106_000)).toHaveLength(1);
    expect(engine.tick(108_000)).toHaveLength(0);
    expect(engine.tick(110_000)).toHaveLength(0);
  });

  it('does not fire while idle — an unarmed rod is not being watched', () => {
    const engine = new DetectionEngine(DEFAULT_DETECTION_PARAMS);
    expect(engine.tick(200_000)).toHaveLength(0);
  });
});

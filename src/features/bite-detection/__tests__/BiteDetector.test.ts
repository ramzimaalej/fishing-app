import type { AccelSample, BiteEvent } from '@/types';

import { BiteDetector } from '../BiteDetector';
import { SignalBuilder } from '../testkit/signal';
import type { BiteDetectorConfig } from '../types';

function detect(
  samples: AccelSample[],
  cfg: Partial<BiteDetectorConfig> = {},
): { bites: BiteEvent[]; detector: BiteDetector } {
  const detector = new BiteDetector(cfg);
  const bites: BiteEvent[] = [];
  for (const s of samples) {
    const { bite } = detector.process(s);
    if (bite) bites.push(bite);
  }
  return { bites, detector };
}

describe('BiteDetector', () => {
  it('does not fire on quiet background noise', () => {
    const samples = new SignalBuilder({ seed: 1 }).quiet(6).build();
    expect(detect(samples).bites).toHaveLength(0);
  });

  it('detects a single big strike and classifies it "big"', () => {
    const samples = new SignalBuilder({ seed: 2 }).quiet(3).bite(1.2).quiet(2).build();
    const { bites } = detect(samples);
    expect(bites).toHaveLength(1);
    expect(bites[0]!.size).toBe('big');
    expect(bites[0]!.peakMagnitude).toBeGreaterThan(0.45);
    expect(bites[0]!.confidence).toBeGreaterThan(0);
    expect(bites[0]!.confidence).toBeLessThanOrEqual(1);
  });

  it('detects a light nibble and classifies it "small"', () => {
    const samples = new SignalBuilder({ seed: 3 }).quiet(3).bite(0.3).quiet(2).build();
    const { bites } = detect(samples);
    expect(bites).toHaveLength(1);
    expect(bites[0]!.size).toBe('small');
  });

  it('preserves order and count across a small→big sequence', () => {
    const samples = new SignalBuilder({ seed: 4 })
      .quiet(3)
      .bite(0.3)
      .quiet(1.5)
      .bite(1.4)
      .quiet(1.5)
      .build();
    const { bites } = detect(samples);
    expect(bites.map((b) => b.size)).toEqual(['small', 'big']);
  });

  it('does not warm up / fire before enough samples are seen', () => {
    // A strike during the warmup window (no prior quiet) should not fire,
    // because the noise floor is not yet established.
    const samples = new SignalBuilder({ seed: 9 }).bite(1.2).quiet(0.2).build();
    const det = new BiteDetector();
    let fired = false;
    for (const s of samples) {
      if (!det.isWarmedUp) det.process(s);
      else {
        if (det.process(s).bite) fired = true;
      }
    }
    // Either way, the bite injected during warm-up must not be reported.
    expect(fired).toBe(false);
  });

  describe('live bait mode', () => {
    const baitOpts = { seed: 5, baitAmplitudeG: 0.15, baitFreqHz: 1.5 };

    it('ignores constant bait motion (no false bites) in both modes', () => {
      const samples = new SignalBuilder(baitOpts).quiet(6).build();
      expect(detect(samples, { liveBaitMode: false }).bites).toHaveLength(0);
      expect(detect(samples, { liveBaitMode: true }).bites).toHaveLength(0);
    });

    it('still catches a real strike over the bait motion', () => {
      const samples = new SignalBuilder(baitOpts).quiet(4).bite(1.2).quiet(2).build();
      const { bites } = detect(samples, { liveBaitMode: true });
      expect(bites).toHaveLength(1);
      expect(bites[0]!.size).toBe('big');
    });

    it('raises the threshold vs. non-live mode on the same warmup', () => {
      const warmup = new SignalBuilder(baitOpts).quiet(4).build();
      const off = new BiteDetector({ liveBaitMode: false });
      const on = new BiteDetector({ liveBaitMode: true });
      warmup.forEach((s) => {
        off.process(s);
        on.process(s);
      });
      expect(on.threshold).toBeGreaterThan(off.threshold);
    });
  });

  describe('sensitivity', () => {
    it('lower sensitivity yields a higher detection threshold', () => {
      const warmup = new SignalBuilder({ seed: 8, noiseSigma: 0.06 }).quiet(3).build();
      const low = new BiteDetector({ sensitivity: 0.1 });
      const high = new BiteDetector({ sensitivity: 0.95 });
      warmup.forEach((s) => {
        low.process(s);
        high.process(s);
      });
      expect(low.threshold).toBeGreaterThan(high.threshold);
    });
  });

  describe('refractory period', () => {
    it('collapses two strikes within the refractory window into one bite', () => {
      // Two bumps ~200ms apart (< default 0.6s refractory).
      const samples = new SignalBuilder({ seed: 11 })
        .quiet(3)
        .bite(1.2, 150)
        .bite(1.2, 150)
        .quiet(2)
        .build();
      const { bites } = detect(samples, { refractorySeconds: 0.6 });
      expect(bites).toHaveLength(1);
    });

    it('reports two separate strikes spaced beyond the refractory window', () => {
      const samples = new SignalBuilder({ seed: 12 })
        .quiet(3)
        .bite(1.2)
        .quiet(1)
        .bite(1.2)
        .quiet(2)
        .build();
      const { bites } = detect(samples, { refractorySeconds: 0.6 });
      expect(bites).toHaveLength(2);
    });
  });

  it('resets cleanly', () => {
    const det = new BiteDetector();
    new SignalBuilder({ seed: 13 }).quiet(3).bite(1.2).build().forEach((s) => det.process(s));
    det.reset();
    expect(det.isWarmedUp).toBe(false);
    expect(det.threshold).toBeCloseTo(0.08); // back to the abs floor
  });
});

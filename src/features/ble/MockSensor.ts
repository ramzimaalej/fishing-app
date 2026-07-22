import type { AccelSample } from '@/types';
import { SENSOR_SAMPLE_RATE_HZ } from '@/config/constants';

import { encodeAccelPacket, parseAccelPacket } from './protocol';
import type { BleDeviceInfo, SensorConnection } from './types';

/**
 * In-memory sensor that streams synthetic accelerometer data in real time so
 * the full detection/graph/feedback pipeline is exercisable with no hardware.
 *
 * It emits ~1 g gravity + noise, optional constant "bait" wiggle when fishing
 * mode is on, and injects random bites (small & big). Data is round-tripped
 * through the real base64 packet codec so the protocol path is exercised too.
 */
export class MockSensor implements SensorConnection {
  readonly info: BleDeviceInfo = { id: 'mock-sensor-001', name: 'FishOn Simulator' };

  private sampleListeners = new Set<(s: AccelSample) => void>();
  private disconnectListeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private sampleRate = SENSOR_SAMPLE_RATE_HZ;
  private fishingMode = false;

  private t = Date.now();
  private n = 0;
  /** Remaining samples of an in-progress injected bite, and its shape. */
  private biteRemaining = 0;
  private biteDuration = 0;
  private bitePeak = 0;

  constructor(private readonly noiseSigma = 0.02) {
    this.start();
  }

  private start(): void {
    if (this.timer) return;
    const intervalMs = 1000 / this.sampleRate;
    // Emit in small batches to mimic BLE notification packets (~5 samples).
    let batch: AccelSample[] = [];
    this.timer = setInterval(() => {
      const s = this.nextSample();
      batch.push(s);
      if (batch.length >= 5) {
        const packet = encodeAccelPacket(batch);
        const decoded = parseAccelPacket(packet);
        for (const d of decoded) {
          this.sampleListeners.forEach((l) => l(d));
        }
        batch = [];
      }
    }, intervalMs);
  }

  private gaussian(): number {
    const u1 = Math.max(Math.random(), 1e-12);
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  private maybeStartBite(): void {
    if (this.biteRemaining > 0) return;
    // ~1.5% chance per sample → a bite every few seconds on average.
    if (Math.random() < 0.015) {
      const big = Math.random() < 0.5;
      this.bitePeak = big ? 0.9 + Math.random() * 0.8 : 0.2 + Math.random() * 0.15;
      this.biteDuration = Math.round((0.18 + Math.random() * 0.12) * this.sampleRate);
      this.biteRemaining = this.biteDuration;
    }
  }

  private nextSample(): AccelSample {
    this.maybeStartBite();

    let bump = 0;
    if (this.biteRemaining > 0) {
      const i = this.biteDuration - this.biteRemaining;
      bump = this.bitePeak * Math.sin((Math.PI * i) / this.biteDuration);
      this.biteRemaining -= 1;
    }

    const bait = this.fishingMode
      ? 0.12 * Math.sin((2 * Math.PI * 1.4 * this.n) / this.sampleRate)
      : 0;

    const sample: AccelSample = {
      t: Math.round(this.t),
      x: this.noiseSigma * this.gaussian(),
      y: this.noiseSigma * this.gaussian(),
      z: 1 + bait + bump + this.noiseSigma * this.gaussian(),
    };
    this.t += 1000 / this.sampleRate;
    this.n += 1;
    return sample;
  }

  onSample(listener: (sample: AccelSample) => void): () => void {
    this.sampleListeners.add(listener);
    return () => this.sampleListeners.delete(listener);
  }

  onDisconnect(listener: () => void): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  async setFishingMode(enabled: boolean): Promise<void> {
    this.fishingMode = enabled;
  }

  async setSampleRate(hz: number): Promise<void> {
    if (hz > 0 && hz !== this.sampleRate) {
      this.sampleRate = hz;
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
        this.start();
      }
    }
  }

  async disconnect(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.disconnectListeners.forEach((l) => l());
    this.sampleListeners.clear();
    this.disconnectListeners.clear();
  }
}

import type { AccelSample } from '@/types';
import { SENSOR_SAMPLE_RATE_HZ } from '@/config/constants';

import { decodeMinewAccFrame, encodeMinewAccFrame } from './minew';
import type { BleDeviceInfo, SensorConnection } from './types';

/**
 * In-memory stand-in for a Minew E8S tag, so the full detection/graph/feedback
 * pipeline is exercisable with no hardware.
 *
 * It mimics the E8S faithfully: it emits ONE advertisement at a time at the
 * tag's (low) broadcast rate, encodes each reading through the real Minew Acc
 * frame codec, and re-decodes it — so the exact wire format and the phone-side
 * arrival timestamping are exercised. It generates ~1 g gravity + noise, an
 * optional constant "bait" wiggle, and injects small/big bites.
 */
export class MockSensor implements SensorConnection {
  readonly info: BleDeviceInfo = {
    id: 'MO:CK:E8:5S:00:01',
    name: 'Castmate Simulator (E8S)',
    battery: 87,
  };

  private sampleListeners = new Set<(s: AccelSample) => void>();
  private disconnectListeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private sampleRate = SENSOR_SAMPLE_RATE_HZ;
  private fishingMode = false;

  private n = 0;
  private biteRemaining = 0;
  private biteDuration = 0;
  private bitePeak = 0;

  constructor(private readonly noiseSigma = 0.02) {
    this.startLoop();
  }

  private startLoop(): void {
    if (this.timer) return;
    const intervalMs = 1000 / this.sampleRate;
    this.timer = setInterval(() => {
      const reading = this.nextReading();
      // Round-trip through the real E8S codec, exactly like the live client.
      const frame = encodeMinewAccFrame({ ...reading, batteryPct: this.info.battery ?? 87, mac: this.info.id });
      const decoded = decodeMinewAccFrame(frame);
      if (!decoded) return;
      const sample: AccelSample = { t: Date.now(), x: decoded.x, y: decoded.y, z: decoded.z };
      this.sampleListeners.forEach((l) => l(sample));
    }, intervalMs);
  }

  private gaussian(): number {
    const u1 = Math.max(Math.random(), 1e-12);
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  private maybeStartBite(): void {
    if (this.biteRemaining > 0) return;
    // ~6% chance per advertisement → a bite every few seconds at the E8S rate.
    if (Math.random() < 0.06) {
      const big = Math.random() < 0.5;
      this.bitePeak = big ? 0.9 + Math.random() * 0.8 : 0.2 + Math.random() * 0.15;
      // Sustained rod-tip motion (0.4–0.7 s) so it's resolvable at the low rate.
      this.biteDuration = Math.max(2, Math.round((0.4 + Math.random() * 0.3) * this.sampleRate));
      this.biteRemaining = this.biteDuration;
    }
  }

  private nextReading(): { x: number; y: number; z: number } {
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
    this.n += 1;

    return {
      x: this.noiseSigma * this.gaussian(),
      y: this.noiseSigma * this.gaussian(),
      z: 1 + bait + bump + this.noiseSigma * this.gaussian(),
    };
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
        this.startLoop();
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

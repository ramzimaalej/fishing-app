import { GRAPH_WINDOW_SIZE } from '@/config/constants';
import type { BiteEvent, BiteVerdict } from '@/types';

import type { AccelPoint } from './types';

/**
 * Rolling fixed-size acceleration window as a plain class.
 *
 * A React hook can only hold one buffer per component, which was fine for a
 * single rod. Multi-rod needs one buffer per rod, owned by a
 * non-React runtime that keeps detecting whether or not that rod's chart is on
 * screen — so the buffering logic lives here, free of React.
 */
export class AccelRingBuffer {
  private points: AccelPoint[] = [];
  private bites: BiteEvent[] = [];

  constructor(private readonly maxSize: number = GRAPH_WINDOW_SIZE) {}

  push(point: AccelPoint): void {
    this.points.push(point);
    if (this.points.length > this.maxSize) {
      this.points.splice(0, this.points.length - this.maxSize);
    }

    // Drop bite markers that have scrolled out of the visible window.
    const oldestT = this.points[0]?.t ?? 0;
    if (this.bites.length > 0 && this.bites[0]!.timestamp < oldestT) {
      this.bites = this.bites.filter((b) => b.timestamp >= oldestT);
    }
  }

  pushBite(bite: BiteEvent): void {
    this.bites.push(bite);
  }

  /**
   * Attach the angler's verdict to a bite already plotted.
   *
   * Replaces the entry rather than mutating it: snapshot() copies the array but
   * not its elements, so a mutated bite would change under a React tree that had
   * already rendered it and the chart would not repaint.
   */
  setBiteVerdict(id: string, verdict: BiteVerdict): void {
    const index = this.bites.findIndex((b) => b.id === id);
    if (index === -1) return;
    this.bites[index] = { ...this.bites[index]!, verdict };
  }

  /** Snapshot for rendering. Copies, so React sees a new identity per flush. */
  snapshot(): { points: AccelPoint[]; bites: BiteEvent[] } {
    return { points: this.points.slice(), bites: this.bites.slice() };
  }

  get size(): number {
    return this.points.length;
  }

  clear(): void {
    this.points = [];
    this.bites = [];
  }
}

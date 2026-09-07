import { useEffect, useState } from 'react';

/**
 * The wall clock, as state that re-renders on an interval.
 *
 * Several screens display something that decays on its own — a tag going quiet,
 * a session window lapsing, a capture's elapsed seconds. Nothing arrives to
 * trigger those repaints: the ABSENCE of an event is the thing being shown, so
 * the clock itself has to be an input the component re-renders *for*.
 *
 * Reading `Date.now()` during render instead makes the output depend on WHEN a
 * render happened to run, so two renders with identical props can disagree.
 * That is what makes such a component misbehave under a compiler free to
 * re-render it whenever it likes, and it is why the value is held in state here
 * rather than sampled at the point of use.
 *
 * @param intervalMs how often to re-read the clock.
 * @param active pass false to stop ticking — an idle screen should not be
 *   re-rendering in the background just to move a number nobody is watching.
 */
export function useNow(intervalMs: number, active = true): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    // Scheduled rather than called straight away: the hook may have mounted long
    // before it went active (a capture that starts minutes into a screen's life),
    // so the first tick would otherwise be a whole interval late. A timeout is
    // used instead of setting state directly because a synchronous setState in
    // an effect costs an extra render pass, and the clock is never that urgent.
    const immediate = setTimeout(() => setNow(Date.now()), 0);
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => {
      clearTimeout(immediate);
      clearInterval(timer);
    };
  }, [intervalMs, active]);

  return now;
}

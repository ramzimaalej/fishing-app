import { ALERT_BANNER_MS, BannerTimer } from '../alertBanner';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it('clears the banner once the window is up', () => {
  const expire = jest.fn();
  const timer = new BannerTimer(expire);

  timer.restart();
  jest.advanceTimersByTime(ALERT_BANNER_MS - 1);
  expect(expire).not.toHaveBeenCalled();

  jest.advanceTimersByTime(1);
  expect(expire).toHaveBeenCalledTimes(1);
});

it('gives a later event its own full window', () => {
  // The hazard: an event at 0, another at 10 s. A pending expiry from the FIRST bite
  // would clear the second one five seconds in — the newest alert would be the
  // shortest-lived thing on screen, and the one most likely to be missed.
  const expire = jest.fn();
  const timer = new BannerTimer(expire);

  timer.restart();
  jest.advanceTimersByTime(10_000);
  timer.restart();

  jest.advanceTimersByTime(ALERT_BANNER_MS - 1);
  expect(expire).not.toHaveBeenCalled();

  jest.advanceTimersByTime(1);
  expect(expire).toHaveBeenCalledTimes(1);
});

it('expires exactly once however often it is restarted', () => {
  // Each restart must REPLACE the pending expiry. Accumulated timers would clear
  // the banner again seconds after the next event raised it.
  const expire = jest.fn();
  const timer = new BannerTimer(expire);

  timer.restart();
  timer.restart();
  timer.restart();

  jest.advanceTimersByTime(ALERT_BANNER_MS * 3);
  expect(expire).toHaveBeenCalledTimes(1);
});

it('does not fire after it is cancelled', () => {
  // Disarm cancels. The callback writes to a runtime that has been removed from
  // the map by then, and a rod put away mid-alert must not publish afterwards.
  const expire = jest.fn();
  const timer = new BannerTimer(expire);

  timer.restart();
  timer.cancel();
  jest.advanceTimersByTime(ALERT_BANNER_MS * 2);

  expect(expire).not.toHaveBeenCalled();
  expect(timer.isRunning()).toBe(false);
});

it('can be cancelled when nothing is pending', () => {
  const timer = new BannerTimer(jest.fn());
  expect(() => timer.cancel()).not.toThrow();
  expect(timer.isRunning()).toBe(false);
});

it('stops running once it has expired', () => {
  // Reported state has to match reality, or a disarm arriving after the window
  // would try to clear a handle that already fired.
  const timer = new BannerTimer(jest.fn());
  timer.restart();
  expect(timer.isRunning()).toBe(true);

  jest.advanceTimersByTime(ALERT_BANNER_MS);
  expect(timer.isRunning()).toBe(false);
});

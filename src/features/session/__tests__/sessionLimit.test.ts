import {
  FREE_SESSION_HOURS,
  FREE_SESSIONS_PER_DAY,
  SESSION_EXPIRY_WARNING_MINUTES,
  SESSION_EXTENSION_HOURS,
} from '@/config/constants';

import {
  canStartFree,
  createWindow,
  extendWindow,
  formatRemaining,
  isExpired,
  isNearExpiry,
  msRemaining,
  sessionDurationMs,
  warningAt,
  type SessionWindow,
} from '../sessionLimit';

const HOUR = 3_600_000;
const MINUTE = 60_000;
const T0 = new Date(2026, 6, 27, 18, 0, 0).getTime(); // 18:00, a plausible start
const DAY_KEY = '2026-07-27';

const freeWindow = (): SessionWindow => createWindow(T0, false, DAY_KEY);
const premiumWindow = (): SessionWindow => createWindow(T0, true, DAY_KEY);

describe('sessionDurationMs', () => {
  it('is the free block for a free account', () => {
    expect(sessionDurationMs(false)).toBe(FREE_SESSION_HOURS * HOUR);
  });

  it('is null (unlimited) for premium', () => {
    expect(sessionDurationMs(true)).toBeNull();
  });
});

describe('createWindow', () => {
  it('expires a free session after the free block', () => {
    const w = freeWindow();
    expect(w.startedAt).toBe(T0);
    expect(w.expiresAt).toBe(T0 + FREE_SESSION_HOURS * HOUR);
    expect(w.extensions).toBe(0);
    expect(w.dayKey).toBe(DAY_KEY);
  });

  it('never expires a premium session', () => {
    expect(premiumWindow().expiresAt).toBeNull();
  });
});

describe('extendWindow', () => {
  it('adds a block to the end when extending early', () => {
    // Extending with time left must not throw the remainder away.
    const w = freeWindow();
    const extended = extendWindow(w, T0 + 1 * HOUR);
    expect(extended.expiresAt).toBe(w.expiresAt! + SESSION_EXTENSION_HOURS * HOUR);
    expect(extended.extensions).toBe(1);
  });

  it('grants a full block when extending after a lapse', () => {
    // The ad bought SESSION_EXTENSION_HOURS of fishing, not "whatever is left".
    const w = freeWindow();
    const lateBy = 2 * HOUR;
    const now = w.expiresAt! + lateBy;
    expect(extendWindow(w, now).expiresAt).toBe(now + SESSION_EXTENSION_HOURS * HOUR);
  });

  it('treats extending exactly at expiry as a full block', () => {
    const w = freeWindow();
    const extended = extendWindow(w, w.expiresAt!);
    expect(extended.expiresAt).toBe(w.expiresAt! + SESSION_EXTENSION_HOURS * HOUR);
  });

  it('accumulates across several extensions', () => {
    let w = freeWindow();
    w = extendWindow(w, T0);
    w = extendWindow(w, T0);
    expect(w.extensions).toBe(2);
    expect(w.expiresAt).toBe(T0 + (FREE_SESSION_HOURS + 2 * SESSION_EXTENSION_HOURS) * HOUR);
  });

  it('is a no-op for an unlimited session', () => {
    const w = premiumWindow();
    const extended = extendWindow(w, T0 + HOUR);
    expect(extended.expiresAt).toBeNull();
    expect(extended.extensions).toBe(0);
  });

  it('never mutates its input', () => {
    const w = freeWindow();
    const before = { ...w };
    extendWindow(w, T0);
    expect(w).toEqual(before);
  });
});

describe('isExpired', () => {
  it('is false before expiry and true at or after it', () => {
    const w = freeWindow();
    expect(isExpired(w, w.expiresAt! - 1)).toBe(false);
    // The boundary matters: at expiry the rods must stop.
    expect(isExpired(w, w.expiresAt!)).toBe(true);
    expect(isExpired(w, w.expiresAt! + HOUR)).toBe(true);
  });

  it('is never true for an unlimited session', () => {
    expect(isExpired(premiumWindow(), T0 + 1000 * HOUR)).toBe(false);
  });

  it('is false with no session', () => {
    expect(isExpired(null, T0)).toBe(false);
  });
});

describe('msRemaining', () => {
  it('counts down', () => {
    const w = freeWindow();
    expect(msRemaining(w, T0)).toBe(FREE_SESSION_HOURS * HOUR);
    expect(msRemaining(w, T0 + HOUR)).toBe((FREE_SESSION_HOURS - 1) * HOUR);
  });

  it('clamps at zero rather than going negative', () => {
    const w = freeWindow();
    expect(msRemaining(w, w.expiresAt! + 5 * HOUR)).toBe(0);
  });

  it('is null for unlimited and 0 for no session', () => {
    expect(msRemaining(premiumWindow(), T0)).toBeNull();
    expect(msRemaining(null, T0)).toBe(0);
  });
});

describe('isNearExpiry / warningAt', () => {
  it('warns inside the warning window', () => {
    const w = freeWindow();
    const inside = w.expiresAt! - (SESSION_EXPIRY_WARNING_MINUTES - 1) * MINUTE;
    expect(isNearExpiry(w, inside)).toBe(true);
  });

  it('does not warn before the window opens', () => {
    const w = freeWindow();
    const before = w.expiresAt! - (SESSION_EXPIRY_WARNING_MINUTES + 1) * MINUTE;
    expect(isNearExpiry(w, before)).toBe(false);
  });

  it('stops warning once expired — that is a different state', () => {
    const w = freeWindow();
    expect(isNearExpiry(w, w.expiresAt!)).toBe(false);
    expect(isNearExpiry(w, w.expiresAt! + MINUTE)).toBe(false);
  });

  it('never warns for an unlimited session', () => {
    expect(isNearExpiry(premiumWindow(), T0)).toBe(false);
    expect(warningAt(premiumWindow())).toBeNull();
  });

  it('places the warning the configured distance before expiry', () => {
    const w = freeWindow();
    expect(warningAt(w)).toBe(w.expiresAt! - SESSION_EXPIRY_WARNING_MINUTES * MINUTE);
  });

  it('has no warning point without a session', () => {
    expect(warningAt(null)).toBeNull();
  });
});

describe('canStartFree', () => {
  it('lets a free account open its daily allowance', () => {
    expect(canStartFree(0, false)).toEqual({ allowed: true });
  });

  it('requires an ad once the allowance is spent', () => {
    expect(canStartFree(FREE_SESSIONS_PER_DAY, false)).toEqual({
      allowed: false,
      reason: 'daily-allowance-used',
    });
  });

  it('counts extensions against the allowance', () => {
    // Otherwise a user could end an expired session and restart for free
    // instead of watching the extension ad, and the cap would mean nothing.
    expect(canStartFree(FREE_SESSIONS_PER_DAY + 3, false).allowed).toBe(false);
  });

  it('never gates premium, however much they have fished', () => {
    expect(canStartFree(0, true)).toEqual({ allowed: true });
    expect(canStartFree(99, true)).toEqual({ allowed: true });
  });
});

describe('formatRemaining', () => {
  it.each([
    [0, 'expired'],
    [-1000, 'expired'],
    [30 * 1000, 'under a minute'],
    [MINUTE, '1m'],
    [42 * MINUTE, '42m'],
    [HOUR, '1h'],
    [5 * HOUR + 42 * MINUTE, '5h 42m'],
    [6 * HOUR, '6h'],
  ])('formats %ims as %s', (ms, expected) => {
    expect(formatRemaining(ms)).toBe(expected);
  });
});

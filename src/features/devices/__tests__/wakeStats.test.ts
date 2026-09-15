/**
 * The durable half of the wake measurement.
 *
 * The runtime's own counters die with the session, which made this number
 * unobtainable in practice: it needed one uninterrupted armed session in which
 * the tag also went quiet, and across several attempts every session ended first
 * — killed by Android, backed out of, or stopped. These totals outlive all of
 * that.
 */

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: () => Promise.resolve(null),
  setItem: () => Promise.resolve(),
  removeItem: () => Promise.resolve(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mod = require('../wakeStats') as typeof import('../wakeStats');
const { useWakeStatsStore, wakeStatsByDevice } = mod;

const TAG_A = '87:2D:9D:C0:0C';
const TAG_B = '87:2D:9D:C0:11';

beforeEach(() => {
  useWakeStatsStore.getState().reset();
});

it('accumulates across separate sessions', () => {
  const { recordAttempt, recordWake } = useWakeStatsStore.getState();

  // Session one: two attempts, one of which woke the tag.
  recordAttempt(TAG_A, 'Fiblink');
  recordWake(TAG_A);
  recordAttempt(TAG_A, 'Fiblink');

  // Session two, after everything in memory has been thrown away and rebuilt.
  recordAttempt(TAG_A, 'Fiblink');
  recordWake(TAG_A);

  expect(useWakeStatsStore.getState().byDevice[TAG_A]).toMatchObject({
    attempts: 3,
    wakes: 2,
  });
});

it('keeps each tag answer to itself', () => {
  // The question is whether waking THIS tag works, and a tag that never answers
  // must not be exonerated by one that does.
  const { recordAttempt, recordWake } = useWakeStatsStore.getState();
  recordAttempt(TAG_A, 'Fiblink');
  recordWake(TAG_A);
  recordAttempt(TAG_B, 'Beachcaster');

  const byDevice = useWakeStatsStore.getState().byDevice;
  expect(byDevice[TAG_A]).toMatchObject({ attempts: 1, wakes: 1 });
  expect(byDevice[TAG_B]).toMatchObject({ attempts: 1, wakes: 0 });
});

it('never credits a wake to a tag that was never tried', () => {
  // A wake is only ever credited against a recorded attempt, so the ratio cannot
  // exceed 1 and cannot report success for a tag nothing was asked of.
  useWakeStatsStore.getState().recordWake(TAG_A);
  expect(useWakeStatsStore.getState().byDevice[TAG_A]).toBeUndefined();
});

it('orders tags by the most recent attempt', () => {
  // The clock is pinned because two attempts in the same millisecond order
  // arbitrarily — the first version of this test was flaky by construction
  // rather than wrong about the behaviour.
  const clock = jest.spyOn(Date, 'now');
  const { recordAttempt } = useWakeStatsStore.getState();

  clock.mockReturnValue(1_000);
  recordAttempt(TAG_A, 'Fiblink');
  clock.mockReturnValue(2_000);
  recordAttempt(TAG_B, 'Beachcaster');

  expect(wakeStatsByDevice().map((r) => r.deviceId)).toEqual([TAG_B, TAG_A]);

  clock.mockRestore();
});

it('carries the rod name for display without keying on it', () => {
  // Keyed by tag, because a tag moved between rods carries its own answer with
  // it. The name is only there so the readout is legible.
  const { recordAttempt } = useWakeStatsStore.getState();
  recordAttempt(TAG_A, 'Fiblink');
  recordAttempt(TAG_A, 'Beachcaster');

  const stats = useWakeStatsStore.getState().byDevice[TAG_A]!;
  expect(stats.attempts).toBe(2);
  expect(stats.label).toBe('Beachcaster');
});

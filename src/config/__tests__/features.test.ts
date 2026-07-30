import { resolveFeatureFlags } from '../features';

/**
 * These guard a fail-safe default. A bug here either ships a paywall on a build
 * meant to be hardware-only, or silently disables the paid tier on a build meant
 * to have one — both invisible until someone notices revenue.
 */
describe('resolveFeatureFlags', () => {
  it('defaults OFF when config is absent', () => {
    // Hardware-only is the safe fallback: gating features nobody sanctioned is
    // worse than gating none.
    expect(resolveFeatureFlags(undefined)).toEqual({ subscriptions: false });
    expect(resolveFeatureFlags(null)).toEqual({ subscriptions: false });
    expect(resolveFeatureFlags({})).toEqual({ subscriptions: false });
  });

  it('accepts a real boolean', () => {
    expect(resolveFeatureFlags({ subscriptions: true })).toEqual({ subscriptions: true });
  });

  it('accepts the string "true", since env vars arrive as strings', () => {
    expect(resolveFeatureFlags({ subscriptions: 'true' })).toEqual({ subscriptions: true });
  });

  it('treats every other value as OFF', () => {
    // Notably "1", "yes" and "TRUE" do NOT enable — only an exact match, so a
    // typo in .env cannot half-enable the paid tier.
    for (const value of ['false', 'FALSE', 'True', 'TRUE', '1', 0, 1, 'yes', '', null, {}]) {
      expect(resolveFeatureFlags({ subscriptions: value }).subscriptions).toBe(false);
    }
  });
});

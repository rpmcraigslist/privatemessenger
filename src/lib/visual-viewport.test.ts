import { describe, expect, it } from 'vitest';

import { visualViewportBottomInset } from './visual-viewport';

describe('visualViewportBottomInset', () => {
  it('returns zero when the visual viewport fills the layout viewport', () => {
    expect(visualViewportBottomInset(800, 800, 0)).toBe(0);
  });

  it('returns keyboard/chrome overlap from the bottom', () => {
    expect(visualViewportBottomInset(800, 520, 0)).toBe(280);
  });

  it('accounts for offset top when the browser shifts the visual viewport', () => {
    expect(visualViewportBottomInset(800, 600, 40)).toBe(160);
  });
});

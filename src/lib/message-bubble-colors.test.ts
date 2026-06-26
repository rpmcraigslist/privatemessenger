import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MESSAGE_BUBBLE_COLOR,
  bubbleStyleForColor,
  buildBubbleColorDirectory,
  isAllowedMessageBubbleColor,
  normalizeMessageBubbleColor,
} from './message-bubble-colors';

describe('message-bubble-colors', () => {
  it('accepts only curated palette colors', () => {
    expect(isAllowedMessageBubbleColor(DEFAULT_MESSAGE_BUBBLE_COLOR)).toBe(true);
    expect(isAllowedMessageBubbleColor('#000000')).toBe(false);
    expect(isAllowedMessageBubbleColor('')).toBe(false);
  });

  it('returns readable foreground for palette colors', () => {
    const style = bubbleStyleForColor(DEFAULT_MESSAGE_BUBBLE_COLOR, true);
    expect(style.backgroundColor).toBe('#005c4b');
    expect(style.color).toBe('#e9edef');
  });

  it('falls back to theme bubbles when color is unknown', () => {
    const style = bubbleStyleForColor('#123456', false);
    expect(style.backgroundColor).toBe('var(--color-bubble-in)');
  });

  it('builds a directory keyed by sub and username', () => {
    const map = buildBubbleColorDirectory([
      {
        username: 'alice',
        cognitoSub: 'sub-alice',
        messageBubbleColor: '#005c4b',
      },
    ]);
    expect(normalizeMessageBubbleColor(map.get('sub-alice'))).toBe('#005c4b');
    expect(normalizeMessageBubbleColor(map.get('alice'))).toBe('#005c4b');
  });
});

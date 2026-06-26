/** Keep in sync with src/lib/message-bubble-colors.ts (Lambda bundle cannot import src). */
export const MESSAGE_BUBBLE_COLOR_VALUES = [
  '#005c4b',
  '#202c33',
  '#1b4332',
  '#0e4d64',
  '#1e3a5f',
  '#2d3561',
  '#4a1942',
  '#5c1a1a',
  '#5c4a1a',
  '#234e52',
] as const;

export const DEFAULT_MESSAGE_BUBBLE_COLOR = MESSAGE_BUBBLE_COLOR_VALUES[0];

export function isAllowedMessageBubbleColor(
  color: string | null | undefined,
): boolean {
  if (!color?.trim()) return false;
  const normalized = color.trim().toLowerCase();
  return MESSAGE_BUBBLE_COLOR_VALUES.some(
    (value) => value.toLowerCase() === normalized,
  );
}

export function resolveMessageBubbleColorAfterSync({
  existing,
  colorArg,
}: {
  existing: string | null | undefined;
  colorArg: string | null | undefined;
}): string {
  if (colorArg === undefined || colorArg === null) {
    return existing ?? DEFAULT_MESSAGE_BUBBLE_COLOR;
  }

  const trimmed = colorArg.trim();
  if (!trimmed) {
    return DEFAULT_MESSAGE_BUBBLE_COLOR;
  }

  if (!isAllowedMessageBubbleColor(trimmed)) {
    throw new Error('Pick a message color from the list');
  }

  return MESSAGE_BUBBLE_COLOR_VALUES.find(
    (value) => value.toLowerCase() === trimmed.toLowerCase(),
  )!;
}

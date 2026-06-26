export type MessageBubbleColorOption = {
  id: string;
  label: string;
  background: string;
  foreground: string;
};

/** Curated bubble colors — all tested for light text on a dark chat background. */
export const MESSAGE_BUBBLE_COLORS: readonly MessageBubbleColorOption[] = [
  { id: 'teal', label: 'Teal', background: '#005c4b', foreground: '#e9edef' },
  { id: 'slate', label: 'Slate', background: '#202c33', foreground: '#e9edef' },
  { id: 'forest', label: 'Forest', background: '#1b4332', foreground: '#e9edef' },
  { id: 'ocean', label: 'Ocean', background: '#0e4d64', foreground: '#e9edef' },
  { id: 'navy', label: 'Navy', background: '#1e3a5f', foreground: '#e9edef' },
  { id: 'indigo', label: 'Indigo', background: '#2d3561', foreground: '#e9edef' },
  { id: 'plum', label: 'Plum', background: '#4a1942', foreground: '#e9edef' },
  { id: 'burgundy', label: 'Burgundy', background: '#5c1a1a', foreground: '#e9edef' },
  { id: 'bronze', label: 'Bronze', background: '#5c4a1a', foreground: '#e9edef' },
  { id: 'pine', label: 'Pine', background: '#234e52', foreground: '#e9edef' },
] as const;

export const DEFAULT_MESSAGE_BUBBLE_COLOR = MESSAGE_BUBBLE_COLORS[0]!.background;

export function isAllowedMessageBubbleColor(
  color: string | null | undefined,
): boolean {
  if (!color?.trim()) return false;
  const normalized = color.trim().toLowerCase();
  return MESSAGE_BUBBLE_COLORS.some(
    (option) => option.background.toLowerCase() === normalized,
  );
}

export function normalizeMessageBubbleColor(
  color: string | null | undefined,
): string | null {
  if (!color?.trim()) return null;
  const normalized = color.trim().toLowerCase();
  const match = MESSAGE_BUBBLE_COLORS.find(
    (option) => option.background.toLowerCase() === normalized,
  );
  return match?.background ?? null;
}

export function bubbleColorsEqual(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  return (
    normalizeMessageBubbleColor(left) === normalizeMessageBubbleColor(right)
  );
}

export type BubbleSurfaceStyle = {
  backgroundColor: string;
  color: string;
  mutedColor: string;
};

export function bubbleStyleForColor(
  color: string | null | undefined,
  fallbackMine: boolean,
): BubbleSurfaceStyle {
  const resolved = normalizeMessageBubbleColor(color);
  const match = MESSAGE_BUBBLE_COLORS.find(
    (option) => option.background === resolved,
  );
  if (match) {
    return {
      backgroundColor: match.background,
      color: match.foreground,
      mutedColor: `${match.foreground}b3`,
    };
  }

  return {
    backgroundColor: fallbackMine
      ? 'var(--color-bubble-out)'
      : 'var(--color-bubble-in)',
    color: '#e9edef',
    mutedColor: 'rgba(255,255,255,0.5)',
  };
}

/** Map cognito sub and lowercase username → bubble background color. */
export function buildBubbleColorDirectory(
  profiles: ReadonlyArray<{
    username: string;
    cognitoSub?: string | null;
    messageBubbleColor?: string | null;
  }>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const profile of profiles) {
    const color = normalizeMessageBubbleColor(profile.messageBubbleColor);
    if (!color) continue;
    if (profile.cognitoSub) {
      map.set(profile.cognitoSub.toLowerCase(), color);
    }
    map.set(profile.username.trim().toLowerCase(), color);
  }
  return map;
}

export function resolveSenderBubbleColor(
  senderUsername: string,
  bubbleColorByKey: Map<string, string>,
  subToUsername: Map<string, string>,
): string | null {
  const sender = senderUsername.trim().toLowerCase();
  if (bubbleColorByKey.has(sender)) {
    return bubbleColorByKey.get(sender)!;
  }

  if (subToUsername.has(sender)) {
    const color = bubbleColorByKey.get(sender);
    if (color) return color;
  }

  const handle = subToUsername.get(senderUsername)?.toLowerCase();
  if (handle && bubbleColorByKey.has(handle)) {
    return bubbleColorByKey.get(handle)!;
  }

  for (const [sub, username] of subToUsername) {
    if (username.toLowerCase() === sender && bubbleColorByKey.has(sub.toLowerCase())) {
      return bubbleColorByKey.get(sub.toLowerCase())!;
    }
  }

  return null;
}

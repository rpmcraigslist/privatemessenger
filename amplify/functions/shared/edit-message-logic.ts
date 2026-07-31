/** Max length for editable message body text. */
export const MAX_MESSAGE_CONTENT_LENGTH = 4000;

export type MessageEditValidation =
  | { ok: true; content: string | null }
  | { ok: false; error: string };

/** Normalize and validate message edit content for the originator. */
export function validateMessageEdit(input: {
  content: string;
  hasAttachment: boolean;
}): MessageEditValidation {
  const trimmed = input.content.trim();
  if (!trimmed && !input.hasAttachment) {
    return { ok: false, error: 'Message text cannot be empty' };
  }
  if (trimmed.length > MAX_MESSAGE_CONTENT_LENGTH) {
    return {
      ok: false,
      error: `Message is too long (max ${MAX_MESSAGE_CONTENT_LENGTH} characters)`,
    };
  }
  return { ok: true, content: trimmed.length > 0 ? trimmed : null };
}

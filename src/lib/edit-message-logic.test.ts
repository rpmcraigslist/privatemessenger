import { describe, expect, it } from 'vitest';
import {
  MAX_MESSAGE_CONTENT_LENGTH,
  validateMessageEdit,
} from '../../amplify/functions/shared/edit-message-logic';

describe('validateMessageEdit', () => {
  it('accepts trimmed text', () => {
    expect(validateMessageEdit({ content: '  hello  ', hasAttachment: false })).toEqual({
      ok: true,
      content: 'hello',
    });
  });

  it('rejects empty text without an attachment', () => {
    expect(validateMessageEdit({ content: '   ', hasAttachment: false })).toEqual({
      ok: false,
      error: 'Message text cannot be empty',
    });
  });

  it('allows clearing caption when an attachment remains', () => {
    expect(validateMessageEdit({ content: '', hasAttachment: true })).toEqual({
      ok: true,
      content: null,
    });
  });

  it('rejects overly long text', () => {
    const result = validateMessageEdit({
      content: 'x'.repeat(MAX_MESSAGE_CONTENT_LENGTH + 1),
      hasAttachment: false,
    });
    expect(result.ok).toBe(false);
  });
});

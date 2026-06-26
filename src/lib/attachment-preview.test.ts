import { describe, expect, it } from 'vitest';
import { guessAttachmentPreviewKind } from './attachment-preview';

describe('guessAttachmentPreviewKind', () => {
  it('detects images from mime type', () => {
    expect(
      guessAttachmentPreviewKind(
        new File(['x'], 'photo.bin', { type: 'image/jpeg' }),
      ),
    ).toBe('image');
  });

  it('detects videos from mime type', () => {
    expect(
      guessAttachmentPreviewKind(
        new File(['x'], 'clip.bin', { type: 'video/mp4' }),
      ),
    ).toBe('video');
  });

  it('falls back to file extension when mime type is missing', () => {
    expect(
      guessAttachmentPreviewKind(new File(['x'], 'vacation.JPG')),
    ).toBe('image');
    expect(
      guessAttachmentPreviewKind(new File(['x'], 'clip.MOV')),
    ).toBe('video');
    expect(
      guessAttachmentPreviewKind(new File(['x'], 'notes.pdf')),
    ).toBe('none');
  });
});

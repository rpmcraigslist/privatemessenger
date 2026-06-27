import { useEffect, useState } from 'react';
import {
  captureVideoPreviewDataUrl,
  guessAttachmentPreviewKind,
  type AttachmentPreviewKind,
} from '../lib/attachment-preview';
import { formatBytes } from '../lib/util';

type Props = {
  file: File;
  onRemove: () => void;
};

export default function PendingAttachmentPreview({ file, onRemove }: Props) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewKind, setPreviewKind] = useState<AttachmentPreviewKind>('none');
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewUnavailable, setPreviewUnavailable] = useState(false);

  useEffect(() => {
    const kind = guessAttachmentPreviewKind(file);
    setPreviewKind(kind);
    setPreviewUrl(null);
    setPreviewUnavailable(false);
    setLoadingPreview(kind !== 'none');

    if (kind === 'none') return;

    let objectUrl: string | null = null;
    let cancelled = false;

    (async () => {
      try {
        if (kind === 'image') {
          objectUrl = URL.createObjectURL(file);
          if (!cancelled) setPreviewUrl(objectUrl);
          return;
        }

        const poster = await captureVideoPreviewDataUrl(file);
        if (!cancelled) setPreviewUrl(poster);
      } catch (err) {
        console.warn('attachment preview failed', err);
        if (!cancelled) setPreviewUnavailable(true);
      } finally {
        if (!cancelled) setLoadingPreview(false);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  const showVisualPreview =
    previewKind !== 'none' &&
    (loadingPreview || previewUrl != null || previewUnavailable);

  return (
    <div className="mb-2 overflow-hidden rounded-lg bg-[var(--color-panel-2)]">
      {showVisualPreview && (
        <div className="relative border-b border-white/5 bg-black/20">
          {loadingPreview && !previewUrl ? (
            <div
              className="flex h-40 items-center justify-center text-sm text-[var(--color-muted)]"
              aria-live="polite"
            >
              Loading preview…
            </div>
          ) : previewUnavailable ? (
            <div className="flex h-32 items-center justify-center px-4 text-center text-sm text-[var(--color-muted)]">
              Preview unavailable for this {previewKind === 'video' ? 'video' : 'image'}{' '}
              format — you can still send it.
            </div>
          ) : previewUrl ? (
            <>
              <img
                src={previewUrl}
                alt={`Preview of ${file.name}`}
                className="max-h-52 w-full object-contain"
                onError={() => {
                  setPreviewUrl(null);
                  setPreviewUnavailable(true);
                }}
              />
              {previewKind === 'video' && (
                <span
                  className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-xs font-medium text-white"
                  aria-hidden
                >
                  Video
                </span>
              )}
            </>
          ) : null}
        </div>
      )}

      <div className="flex items-center gap-2 px-3 py-2 text-sm">
        <span className="truncate">{file.name}</span>
        <span className="shrink-0 text-xs text-[var(--color-muted)]">
          {formatBytes(file.size)}
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="ml-auto text-[var(--color-muted)] hover:text-white"
          aria-label="Remove attachment"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

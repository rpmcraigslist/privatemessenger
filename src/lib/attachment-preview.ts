export type AttachmentPreviewKind = 'image' | 'video' | 'none';

const IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'bmp',
  'avif',
]);

const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv']);

/** Best-effort media kind for local preview (mime type, then file extension). */
export function guessAttachmentPreviewKind(file: File): AttachmentPreviewKind {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';

  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  return 'none';
}

const VIDEO_PREVIEW_MAX_EDGE_PX = 720;

/** Capture a JPEG data URL from the first frame of a local video file. */
export function captureVideoPreviewDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;

    const cleanup = () => {
      URL.revokeObjectURL(objectUrl);
      video.removeAttribute('src');
      video.load();
    };

    const fail = (reason?: unknown) => {
      cleanup();
      reject(reason ?? new Error('Could not preview video'));
    };

    video.addEventListener('error', () => fail(), { once: true });

    video.addEventListener(
      'loadeddata',
      () => {
        const seekTime = Math.min(
          0.1,
          Math.max(0, (video.duration || 0) * 0.01),
        );
        video.currentTime = seekTime;
      },
      { once: true },
    );

    video.addEventListener(
      'seeked',
      () => {
        try {
          const width = video.videoWidth;
          const height = video.videoHeight;
          if (!width || !height) {
            fail();
            return;
          }

          const scale = Math.min(
            1,
            VIDEO_PREVIEW_MAX_EDGE_PX / Math.max(width, height),
          );
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(width * scale);
          canvas.height = Math.round(height * scale);
          const context = canvas.getContext('2d');
          if (!context) {
            fail();
            return;
          }

          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          cleanup();
          resolve(dataUrl);
        } catch (err) {
          fail(err);
        }
      },
      { once: true },
    );

    video.src = objectUrl;
    video.load();
  });
}

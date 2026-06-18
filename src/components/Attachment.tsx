import { useEffect, useState } from 'react';
import { getUrl } from 'aws-amplify/storage';
import { client } from '../lib/amplify';

type Props = {
  conversationId: string;
  path: string;
  name: string;
  isImage: boolean;
};

/**
 * Resolves an attachment for display.
 * - Conversation-scoped keys go through getAttachmentUrl (membership checked).
 * - Legacy uploader-owned keys fall back to direct getUrl for the uploader.
 */
export default function Attachment({
  conversationId,
  path,
  name,
  isImage,
}: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        let resolved: string;
        if (path.startsWith(`conversations/${conversationId}/`)) {
          const { data, errors } = await client.queries.getAttachmentUrl({
            conversationId,
            attachmentKey: path,
          });
          if (errors?.length || !data) {
            throw new Error(errors?.[0]?.message ?? 'Attachment unavailable');
          }
          resolved = data;
        } else {
          const result = await getUrl({ path });
          resolved = result.url.toString();
        }
        if (active) setUrl(resolved);
      } catch (err) {
        console.error('failed to resolve attachment url', err);
        if (active) setFailed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [conversationId, path]);

  if (failed) {
    return <p className="text-xs text-white/60">Attachment unavailable</p>;
  }

  if (!url) {
    return (
      <div className="my-1 h-32 w-48 animate-pulse rounded-md bg-white/10" />
    );
  }

  if (isImage) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="block">
        <img
          src={url}
          alt={name}
          className="my-1 max-h-72 w-full rounded-md object-cover"
          loading="lazy"
        />
      </a>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      download={name}
      className="my-1 flex items-center gap-2 rounded-md bg-black/20 px-3 py-2 transition hover:bg-black/30"
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M14 3v4a1 1 0 0 0 1 1h4M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
      <span className="truncate text-sm">{name}</span>
    </a>
  );
}

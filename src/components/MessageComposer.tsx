import { useRef, useState } from 'react';
import { uploadData } from 'aws-amplify/storage';
import { client, type ConversationModel, type MessageModel } from '../lib/amplify';
import {
  formatBytes,
  messageListPreview,
  normalizeUsername,
  participantDisplayName,
  ensureParticipantSubs,
  type ReplyTarget,
} from '../lib/util';
import PendingAttachmentPreview from './PendingAttachmentPreview';

type Props = {
  conversation: ConversationModel;
  myUsername: string;
  mySub: string;
  handleToSub: Map<string, string>;
  subToUsername: Map<string, string>;
  replyTo?: ReplyTarget | null;
  onCancelReply?: () => void;
  onSent?: () => void;
  onMessageCreated?: (message: MessageModel) => void;
};

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB guardrail.

export default function MessageComposer({
  conversation,
  myUsername,
  mySub,
  handleToSub,
  subToUsername,
  replyTo,
  onCancelReply,
  onSent,
  onMessageCreated,
}: Props) {
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canSend = (text.trim().length > 0 || file != null) && !sending;

  function pickFile(selected: File | null) {
    setError(null);
    if (selected && selected.size > MAX_FILE_BYTES) {
      setError(`File too large (max ${formatBytes(MAX_FILE_BYTES)}).`);
      return;
    }
    setFile(selected);
  }

  async function send() {
    if (!canSend) return;
    setSending(true);
    setError(null);
    const body = text.trim();
    try {
      let attachmentKey: string | undefined;
      let attachmentName: string | undefined;
      let type: 'text' | 'image' | 'file' = 'text';

      if (file) {
        const safeName = file.name.replace(/[^\w.\-]+/g, '_');
        const result = await uploadData({
          path: ({ identityId }) =>
            `conversations/${conversation.id}/${identityId}/${Date.now()}-${safeName}`,
          data: file,
          options: { contentType: file.type || 'application/octet-stream' },
        }).result;
        attachmentKey = result.path;
        attachmentName = file.name;
        type = file.type.startsWith('image/') ? 'image' : 'file';
      }

      const participantUsernames = ensureParticipantSubs(
        conversation.participants.filter((p): p is string => !!p),
        myUsername,
        mySub,
        handleToSub,
      );

      const { data: created, errors: createErrors } = await client.models.Message.create({
        conversationId: conversation.id,
        content: body || undefined,
        senderUsername: normalizeUsername(myUsername),
        participantUsernames,
        type,
        attachmentKey,
        attachmentName,
        ...(replyTo
          ? {
              replyToMessageId: replyTo.messageId,
              replyToSenderUsername: replyTo.senderUsername,
              replyToContentPreview: replyTo.contentPreview,
            }
          : {}),
      });

      if (createErrors?.length) {
        throw new Error(createErrors[0].message);
      }

      if (created) {
        onMessageCreated?.({
          ...created,
          conversationId: created.conversationId ?? conversation.id,
        });
      }

      if (created?.id) {
        try {
          const { data, errors } = await client.mutations.sendMessageAlerts({
            messageId: created.id,
            appUrl: window.location.origin,
          });
          if (errors?.length) {
            console.error('message alert mutation failed', errors);
          } else if (data && data.sent === 0 && (data.failed ?? 0) > 0) {
            console.error(
              'message alert delivery failed — check SES config and CloudWatch logs',
              data,
            );
          } else if (data && data.sent === 0 && (data.skipped ?? 0) > 0) {
            console.info(
              'message alert skipped — recipient has no contact email configured',
              data,
            );
          }
        } catch (err) {
          console.error('message alert failed', err);
        }
      }

      const preview = messageListPreview({
        content: body,
        type,
        attachmentName,
      });
      await client.models.Conversation.update({
        id: conversation.id,
        lastMessage: preview.slice(0, 120),
        lastMessageAt: new Date().toISOString(),
      });

      setText('');
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      onCancelReply?.();
      onSent?.();
    } catch (err) {
      console.error('failed to send message', err);
      setError('Failed to send. Please try again.');
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
    if (e.key === 'Escape' && replyTo) {
      e.preventDefault();
      onCancelReply?.();
    }
  }

  return (
    <div className="bg-[var(--color-panel)] px-3 py-2.5">
      {error && <p className="mb-2 text-xs text-red-400">{error}</p>}

      {replyTo && (
        <div className="mb-2 flex items-start gap-2 rounded-lg border-l-4 border-[var(--color-accent)] bg-[var(--color-panel-2)] px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-[var(--color-accent)]">
              Replying to{' '}
              {participantDisplayName(replyTo.senderUsername, subToUsername)}
            </p>
            <p className="truncate text-sm text-[var(--color-muted)]">
              {replyTo.contentPreview}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            className="shrink-0 text-[var(--color-muted)] hover:text-white"
            aria-label="Cancel reply"
          >
            ✕
          </button>
        </div>
      )}

      {file && (
        <PendingAttachmentPreview
          file={file}
          onRemove={() => pickFile(null)}
        />
      )}

      <div className="flex items-end gap-2">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[var(--color-muted)] transition hover:bg-white/10 hover:text-white"
          title="Attach"
          aria-label="Attach file"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path
              d="M21 11.5 12.5 20a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L10 17.4a1.6 1.6 0 0 1-2.3-2.3l7.8-7.8"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
        />

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={replyTo ? 'Type your reply' : 'Type a message'}
          className="max-h-32 min-h-10 flex-1 resize-none rounded-2xl bg-[var(--color-panel-2)] px-4 py-2.5 text-[15px] outline-none placeholder:text-[var(--color-muted)]"
        />

        <button
          onClick={() => void send()}
          disabled={!canSend}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white transition disabled:opacity-40"
          style={{ background: 'var(--color-accent)' }}
          title="Send"
          aria-label="Send message"
        >
          {sending ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M4 12 20 4l-4 16-4-7-8-1Z"
                fill="currentColor"
              />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

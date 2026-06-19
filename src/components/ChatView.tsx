import { useEffect, useRef, useState } from 'react';
import { client, type ConversationModel, type MessageModel } from '../lib/amplify';
import { conversationTitle, displayName, formatTime } from '../lib/util';
import Avatar from './Avatar';
import MessageComposer from './MessageComposer';
import Attachment from './Attachment';

type Props = {
  conversation: ConversationModel;
  myUsername: string;
  mySub: string;
  subToUsername: Map<string, string>;
  onBack: () => void;
};

export default function ChatView({
  conversation,
  myUsername,
  mySub,
  subToUsername,
  onBack,
}: Props) {
  const [messages, setMessages] = useState<MessageModel[]>([]);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  const title = conversationTitle(
    conversation.participants,
    conversation.name,
    mySub,
    subToUsername,
  );

  useEffect(() => {
    setLoading(true);
    const sub = client.models.Message.observeQuery({
      filter: { conversationId: { eq: conversation.id } },
    }).subscribe({
      next: ({ items }) => {
        const sorted = [...items].sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
        setMessages(sorted);
        setLoading(false);
      },
      error: (err) => {
        console.error('message subscription error', err);
        setLoading(false);
      },
    });
    return () => sub.unsubscribe();
  }, [conversation.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  return (
    <>
      <header className="flex items-center gap-3 border-b border-black/30 bg-[var(--color-panel)] px-3 py-2.5">
        <button
          onClick={onBack}
          className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--color-muted)] hover:bg-white/10 hover:text-white md:hidden"
          aria-label="Back"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path
              d="m15 18-6-6 6-6"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <Avatar label={title} colorKey={conversation.id} size={40} />
        <div className="min-w-0">
          <p className="truncate font-medium">{title}</p>
          <p className="truncate text-xs text-[var(--color-muted)]">
            {conversation.participants.filter(Boolean).length} participant
            {conversation.participants.length === 1 ? '' : 's'}
          </p>
        </div>
      </header>

      <div
        className="min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-12"
        style={{
          backgroundColor: 'var(--color-app-bg)',
          backgroundImage:
            'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.03) 1px, transparent 0)',
          backgroundSize: '22px 22px',
        }}
      >
        {loading ? (
          <p className="py-6 text-center text-sm text-[var(--color-muted)]">
            Loading messages…
          </p>
        ) : messages.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--color-muted)]">
            No messages yet. Say hello!
          </p>
        ) : (
          <div className="mx-auto flex max-w-2xl flex-col gap-1.5">
            {messages.map((m, i) => {
              const mine = m.senderUsername === myUsername;
              const prev = messages[i - 1];
              const showSender =
                !mine &&
                conversation.participants.length > 2 &&
                prev?.senderUsername !== m.senderUsername;
              return (
                <Bubble
                  key={m.id}
                  message={m}
                  mine={mine}
                  showSender={showSender}
                />
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <MessageComposer conversation={conversation} myUsername={myUsername} />
    </>
  );
}

function Bubble({
  message,
  mine,
  showSender,
}: {
  message: MessageModel;
  mine: boolean;
  showSender: boolean;
}) {
  return (
    <div className={`flex ${mine ? 'justify-start' : 'justify-end'}`}>
      <div
        className="max-w-[80%] rounded-lg px-2.5 py-1.5 text-[15px] shadow-sm"
        style={{
          backgroundColor: mine
            ? 'var(--color-bubble-out)'
            : 'var(--color-bubble-in)',
        }}
      >
        {showSender && (
          <p
            className="mb-0.5 text-xs font-semibold"
            style={{ color: 'var(--color-accent)' }}
          >
            {displayName(message.senderUsername)}
          </p>
        )}
        {message.attachmentKey && (
          <Attachment
            conversationId={message.conversationId}
            path={message.attachmentKey}
            name={message.attachmentName ?? 'file'}
            isImage={message.type === 'image'}
          />
        )}
        {message.content && (
          <p className="whitespace-pre-wrap break-words text-left">{message.content}</p>
        )}
        <span
          className={`mt-0.5 block text-[10px] text-white/50 ${mine ? 'text-left' : 'text-right'}`}
        >
          {formatTime(message.createdAt)}
        </span>
      </div>
    </div>
  );
}

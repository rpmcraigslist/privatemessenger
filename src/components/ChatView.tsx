import { useCallback, useEffect, useRef, useState } from 'react';
import { client, type ConversationModel, type MessageModel } from '../lib/amplify';
import { markConversationRead } from '../lib/read-state';
import {
  conversationTitle,
  formatTime,
  isSameMessengerUser,
  participantDisplayName,
  resolveParticipantHandle,
} from '../lib/util';
import Avatar from './Avatar';
import ChatGroupPanel from './ChatGroupPanel';
import MessageComposer from './MessageComposer';
import Attachment from './Attachment';

type Props = {
  conversation: ConversationModel;
  myUsername: string;
  mySub: string;
  subToUsername: Map<string, string>;
  onBack: () => void;
  onConversationUpdated: () => void;
};

export default function ChatView({
  conversation,
  myUsername,
  mySub,
  subToUsername,
  onBack,
  onConversationUpdated,
}: Props) {
  const [messages, setMessages] = useState<MessageModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDetails, setShowDetails] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const title = conversationTitle(
    conversation.participants,
    conversation.name,
    mySub,
    myUsername,
    subToUsername,
  );

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const container = scrollRef.current;
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior });
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior });
  }, []);

  const markRead = useCallback(
    (items: MessageModel[]) => {
      const last = items[items.length - 1];
      if (!last) return;
      markConversationRead(mySub, conversation.id, last.createdAt);
      onConversationUpdated();
    },
    [conversation.id, mySub, onConversationUpdated],
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
        markRead(sorted);
      },
      error: (err) => {
        console.error('message subscription error', err);
        setLoading(false);
      },
    });
    return () => sub.unsubscribe();
  }, [conversation.id, markRead]);

  useEffect(() => {
    scrollToBottom('auto');
  }, [conversation.id, scrollToBottom]);

  useEffect(() => {
    if (!loading) {
      scrollToBottom('smooth');
    }
  }, [messages.length, loading, scrollToBottom]);

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
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{title}</p>
          <p className="truncate text-xs text-[var(--color-muted)]">
            {conversation.participants.filter(Boolean).length} participant
            {conversation.participants.length === 1 ? '' : 's'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowDetails(true)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--color-muted)] hover:bg-white/10 hover:text-white"
          title="Chat details"
          aria-label="Chat details"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="5" r="1.5" fill="currentColor" />
            <circle cx="12" cy="12" r="1.5" fill="currentColor" />
            <circle cx="12" cy="19" r="1.5" fill="currentColor" />
          </svg>
        </button>
      </header>

      <div
        ref={scrollRef}
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
              const mine = isSameMessengerUser(
                m.senderUsername,
                myUsername,
                mySub,
                subToUsername,
              );
              const prev = messages[i - 1];
              const showSender =
                !mine &&
                conversation.participants.length > 2 &&
                resolveParticipantHandle(
                  prev?.senderUsername ?? '',
                  subToUsername,
                ) !==
                  resolveParticipantHandle(m.senderUsername, subToUsername);
              return (
                <Bubble
                  key={m.id}
                  message={m}
                  mine={mine}
                  showSender={showSender}
                  subToUsername={subToUsername}
                />
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <MessageComposer conversation={conversation} myUsername={myUsername} />

      {showDetails && (
        <ChatGroupPanel
          conversation={conversation}
          myUsername={myUsername}
          mySub={mySub}
          subToUsername={subToUsername}
          onClose={() => setShowDetails(false)}
          onRenamed={() => {
            onConversationUpdated();
            setShowDetails(false);
          }}
        />
      )}
    </>
  );
}

function Bubble({
  message,
  mine,
  showSender,
  subToUsername,
}: {
  message: MessageModel;
  mine: boolean;
  showSender: boolean;
  subToUsername: Map<string, string>;
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
            {participantDisplayName(message.senderUsername, subToUsername)}
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

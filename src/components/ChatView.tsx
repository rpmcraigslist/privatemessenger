import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { client, type ConversationModel, type MessageModel } from '../lib/amplify';
import { getLastReadAt, markConversationRead } from '../lib/read-state';
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

/** flex-col-reverse keeps new messages at the visual bottom without scrollTop hacks. */
const SCROLL_AT_BOTTOM_THRESHOLD_PX = 96;

export default function ChatView({
  conversation,
  myUsername,
  mySub,
  subToUsername,
  onBack,
  onConversationUpdated,
}: Props) {
  const [messages, setMessages] = useState<MessageModel[]>([]);
  const [synced, setSynced] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const onConversationUpdatedRef = useRef(onConversationUpdated);
  onConversationUpdatedRef.current = onConversationUpdated;
  const markReadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const title = conversationTitle(
    conversation.participants,
    conversation.name,
    mySub,
    myUsername,
    subToUsername,
  );

  const scheduleMarkRead = useCallback(
    (items: MessageModel[]) => {
      if (markReadTimerRef.current) {
        clearTimeout(markReadTimerRef.current);
      }
      markReadTimerRef.current = setTimeout(() => {
        const last = items[items.length - 1];
        if (!last) return;
        const previous = getLastReadAt(mySub, conversation.id);
        if (previous === last.createdAt) return;
        markConversationRead(mySub, conversation.id, last.createdAt);
        onConversationUpdatedRef.current();
      }, 400);
    },
    [conversation.id, mySub],
  );

  useEffect(() => {
    stickToBottomRef.current = true;
    setMessages([]);
    setSynced(false);

    const sub = client.models.Message.observeQuery({
      filter: { conversationId: { eq: conversation.id } },
    }).subscribe({
      next: ({ items, isSynced }) => {
        const sorted = [...items].sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
        setMessages(sorted);
        setSynced(isSynced);
        if (isSynced) {
          scheduleMarkRead(sorted);
        }
      },
      error: (err) => {
        console.error('message subscription error', err);
        setSynced(true);
      },
    });

    return () => {
      sub.unsubscribe();
      if (markReadTimerRef.current) {
        clearTimeout(markReadTimerRef.current);
      }
    };
  }, [conversation.id, scheduleMarkRead]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const onScroll = () => {
      // In a column-reverse scroller, scrollTop 0 is the visual bottom.
      stickToBottomRef.current =
        container.scrollTop <= SCROLL_AT_BOTTOM_THRESHOLD_PX;
    };

    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, [conversation.id]);

  const showInitialLoading = !synced && messages.length === 0;
  const showEmpty = synced && messages.length === 0;
  const messagesNewestFirst = useMemo(
    () => [...messages].reverse(),
    [messages],
  );

  const pinToBottom = useCallback(() => {
    const container = scrollRef.current;
    if (!container || !stickToBottomRef.current) return;
    container.scrollTop = 0;
  }, []);

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
        className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto px-3 py-4 md:px-12"
        style={{
          backgroundColor: 'var(--color-app-bg)',
          backgroundImage:
            'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.03) 1px, transparent 0)',
          backgroundSize: '22px 22px',
          overflowAnchor: 'none',
        }}
      >
        {showInitialLoading ? (
          <p className="py-6 text-center text-sm text-[var(--color-muted)]">
            Loading messages…
          </p>
        ) : showEmpty ? (
          <p className="py-6 text-center text-sm text-[var(--color-muted)]">
            No messages yet. Say hello!
          </p>
        ) : (
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-1.5">
            {messagesNewestFirst.map((m, i) => {
              const mine = isSameMessengerUser(
                m.senderUsername,
                myUsername,
                mySub,
                subToUsername,
              );
              const prev = messagesNewestFirst[i + 1];
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
                  onLayout={pinToBottom}
                />
              );
            })}
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
  onLayout,
}: {
  message: MessageModel;
  mine: boolean;
  showSender: boolean;
  subToUsername: Map<string, string>;
  onLayout?: () => void;
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
            onLoad={onLayout}
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

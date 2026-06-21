import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';

import { client, type ConversationModel, type MessageModel } from '../lib/amplify';

import {
  findLastUnreadMessage,
  getLastReadAt,
  markConversationReadThrough,
} from '../lib/read-state';

import {

  conversationTitle,

  formatTime,

  isSameMessengerUser,

  messageMatchesSearch,

  participantDisplayName,

  replyTargetFromMessage,

  resolveParticipantHandle,

  splitBySearchQuery,

  type ReplyTarget,

} from '../lib/util';

import Avatar from './Avatar';

import ChatGroupPanel from './ChatGroupPanel';

import MessageComposer from './MessageComposer';

import Attachment from './Attachment';
import { pushAppNavigationLayer } from '../lib/back-navigation';

export type ChatBackHandle = {
  handleBack: () => boolean;
};

type Props = {

  conversation: ConversationModel;

  messages: MessageModel[];

  messagesSynced: boolean;

  myUsername: string;

  mySub: string;

  handleToSub: Map<string, string>;

  subToUsername: Map<string, string>;

  chatBackRef?: MutableRefObject<ChatBackHandle | null>;

  onBack: () => void;

  onConversationUpdated: () => void;

  onConversationRenamed: (name: string | null) => void;

  onMessageCreated?: (message: MessageModel) => void;

  onMessageDeleted?: (messageId: string) => void;

};



type MessageMenuState = {

  message: MessageModel;

  mine: boolean;

  x: number;

  y: number;

};



const SCROLL_AT_BOTTOM_THRESHOLD_PX = 96;



export default function ChatView({

  conversation,

  messages,

  messagesSynced,

  myUsername,

  mySub,

  handleToSub,

  subToUsername,

  chatBackRef,

  onBack,

  onConversationUpdated,

  onConversationRenamed,

  onMessageCreated,

  onMessageDeleted,

}: Props) {

  const [showDetails, setShowDetails] = useState(false);

  const [searchOpen, setSearchOpen] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');

  const [activeMatchIndex, setActiveMatchIndex] = useState(0);

  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);

  const [flashMessageId, setFlashMessageId] = useState<string | null>(null);

  const [messageMenu, setMessageMenu] = useState<MessageMenuState | null>(null);

  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);

  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!chatBackRef) return;

    chatBackRef.current = {
      handleBack: () => {
        if (showDetails) {
          setShowDetails(false);
          return true;
        }
        if (searchOpen) {
          setSearchOpen(false);
          setSearchQuery('');
          return true;
        }
        if (replyTo) {
          setReplyTo(null);
          return true;
        }
        if (messageMenu) {
          setMessageMenu(null);
          return true;
        }
        return false;
      },
    };

    return () => {
      chatBackRef.current = null;
    };
  }, [chatBackRef, messageMenu, replyTo, searchOpen, showDetails]);

  const overlayNavRef = useRef({
    showDetails: false,
    searchOpen: false,
    hasReply: false,
  });

  useEffect(() => {
    const prev = overlayNavRef.current;
    const opened =
      (showDetails && !prev.showDetails) ||
      (searchOpen && !prev.searchOpen) ||
      (Boolean(replyTo) && !prev.hasReply);
    if (opened) pushAppNavigationLayer();
    overlayNavRef.current = {
      showDetails,
      searchOpen,
      hasReply: Boolean(replyTo),
    };
  }, [showDetails, searchOpen, replyTo]);

  const scrollRef = useRef<HTMLDivElement>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);

  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const stickToBottomRef = useRef(true);

  const entryScrollDoneRef = useRef(false);

  const onConversationUpdatedRef = useRef(onConversationUpdated);

  onConversationUpdatedRef.current = onConversationUpdated;

  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const latestMessagesRef = useRef<MessageModel[]>([]);

  const markVisibleMessagesRead = useCallback(
    (items: MessageModel[]) => {
      latestMessagesRef.current = items;
      if (
        markConversationReadThrough(
          mySub,
          myUsername,
          conversation.id,
          items,
        )
      ) {
        onConversationUpdatedRef.current();
      }
    },
    [conversation.id, mySub, myUsername],
  );

  const title = conversationTitle(
    conversation.participants,
    conversation.name,
    mySub,
    myUsername,
    subToUsername,
  );

  const searchMatches = useMemo(() => {

    const q = searchQuery.trim();

    if (!q) return [];

    return messages.filter((m) => messageMatchesSearch(m, q)).map((m) => m.id);

  }, [messages, searchQuery]);



  const scrollToMessage = useCallback((
    messageId: string,
    flashOrOptions:
      | boolean
      | {
          flash?: boolean;
          block?: ScrollLogicalPosition;
          behavior?: ScrollBehavior;
        } = true,
  ): boolean => {
    const el = messageRefs.current.get(messageId);
    if (!el) return false;

    const options =
      typeof flashOrOptions === 'boolean'
        ? { flash: flashOrOptions }
        : flashOrOptions;

    stickToBottomRef.current = false;

    el.scrollIntoView({
      behavior: options.behavior ?? 'smooth',
      block: options.block ?? 'center',
    });

    if (options.flash ?? true) {
      setFlashMessageId(messageId);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => setFlashMessageId(null), 1800);
    }

    return true;
  }, []);



  useEffect(() => {

    entryScrollDoneRef.current = false;

    stickToBottomRef.current = true;

    setSearchOpen(false);

    setSearchQuery('');

    setActiveMatchIndex(0);

    setReplyTo(null);

    setMessageMenu(null);

  }, [conversation.id]);



  useEffect(() => {

    if (!messageMenu) return;

    function closeMenu() {

      setMessageMenu(null);

    }

    window.addEventListener('pointerdown', closeMenu);

    window.addEventListener('scroll', closeMenu, true);

    return () => {

      window.removeEventListener('pointerdown', closeMenu);

      window.removeEventListener('scroll', closeMenu, true);

    };

  }, [messageMenu]);



  const openMessageMenu = useCallback(

    (message: MessageModel, mine: boolean, x: number, y: number) => {

      setActionError(null);

      setMessageMenu({ message, mine, x, y });

    },

    [],

  );



  const handleDeleteMessage = useCallback(

    async (message: MessageModel) => {

      setMessageMenu(null);

      setDeleteBusyId(message.id);

      setActionError(null);

      try {

        const { data, errors } = await client.mutations.deleteMyMessage({

          messageId: message.id,

        });

        if (errors?.length) throw new Error(errors[0].message);

        if (!data?.deleted) throw new Error('Delete failed');

        onMessageDeleted?.(message.id);

      } catch (err) {

        console.error('delete message failed', err);

        setActionError(

          err instanceof Error ? err.message : 'Could not delete message',

        );

      } finally {

        setDeleteBusyId(null);

      }

    },

    [onMessageDeleted],

  );



  useEffect(() => {

    if (messages.length > 0) {

      markVisibleMessagesRead(messages);

    }

  }, [messages, markVisibleMessagesRead]);



  useEffect(() => {

    return () => {

      markVisibleMessagesRead(latestMessagesRef.current);

      if (flashTimerRef.current) {

        clearTimeout(flashTimerRef.current);

      }

    };

  }, [conversation.id, markVisibleMessagesRead]);



  useEffect(() => {

    const container = scrollRef.current;

    if (!container) return;



    const onScroll = () => {

      const distanceFromBottom =

        container.scrollHeight - container.scrollTop - container.clientHeight;

      stickToBottomRef.current =

        distanceFromBottom <= SCROLL_AT_BOTTOM_THRESHOLD_PX;

    };



    container.addEventListener('scroll', onScroll, { passive: true });

    return () => container.removeEventListener('scroll', onScroll);

  }, [conversation.id]);



  useEffect(() => {

    setActiveMatchIndex(0);

  }, [searchQuery]);



  useEffect(() => {

    if (searchMatches.length === 0) return;

    const safeIndex = activeMatchIndex % searchMatches.length;

    scrollToMessage(searchMatches[safeIndex], true);

  }, [activeMatchIndex, searchMatches, scrollToMessage]);



  useEffect(() => {

    if (!searchOpen) return;

    searchInputRef.current?.focus();

  }, [searchOpen]);



  useEffect(() => {

    function onKeyDown(e: KeyboardEvent) {

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {

        e.preventDefault();

        setSearchOpen(true);

      }

      if (e.key === 'Escape' && searchOpen) {

        setSearchOpen(false);

        setSearchQuery('');

      }

    }

    window.addEventListener('keydown', onKeyDown);

    return () => window.removeEventListener('keydown', onKeyDown);

  }, [searchOpen]);



  const showInitialLoading = !messagesSynced && messages.length === 0;

  const showEmpty = messagesSynced && messages.length === 0;



  const pinToBottom = useCallback((force = false) => {

    const container = scrollRef.current;

    if (!container || (!force && !stickToBottomRef.current)) return;

    container.scrollTop = container.scrollHeight;

  }, []);



  const scrollToEntryPosition = useCallback(() => {

    if (entryScrollDoneRef.current || messages.length === 0 || !messagesSynced) return;

    const lastReadAt = getLastReadAt(mySub, myUsername, conversation.id);

    const lastUnread = findLastUnreadMessage(

      messages,

      lastReadAt,

      myUsername,

      mySub,

      subToUsername,

    );

    let scrolled = false;

    if (lastUnread) {

      scrolled = scrollToMessage(lastUnread.id, {

        flash: false,

        block: 'end',

        behavior: 'instant',

      });

    } else {

      stickToBottomRef.current = true;

      pinToBottom(true);

      scrolled = true;

    }

    markVisibleMessagesRead(messages);

    if (scrolled) {

      entryScrollDoneRef.current = true;

    }

  }, [

    conversation.id,

    messages,

    messagesSynced,

    markVisibleMessagesRead,

    mySub,

    myUsername,

    pinToBottom,

    scrollToMessage,

    subToUsername,

  ]);



  useEffect(() => {

    requestAnimationFrame(() => {

      requestAnimationFrame(() => scrollToEntryPosition());

    });

  }, [scrollToEntryPosition]);



  useEffect(() => {

    if (!entryScrollDoneRef.current) return;

    if (!stickToBottomRef.current) return;

    requestAnimationFrame(() => pinToBottom());

  }, [messages, pinToBottom]);



  const handleMessageSent = useCallback(() => {

    stickToBottomRef.current = true;

    requestAnimationFrame(() => pinToBottom(true));

  }, [pinToBottom]);



  function goToPrevMatch() {

    if (searchMatches.length === 0) return;

    setActiveMatchIndex(

      (i) => (i - 1 + searchMatches.length) % searchMatches.length,

    );

  }



  function goToNextMatch() {

    if (searchMatches.length === 0) return;

    setActiveMatchIndex((i) => (i + 1) % searchMatches.length);

  }



  const trimmedSearch = searchQuery.trim();

  const hasSearch = trimmedSearch.length > 0;

  const matchLabel =

    searchMatches.length > 0

      ? `${(activeMatchIndex % searchMatches.length) + 1} of ${searchMatches.length}`

      : hasSearch

        ? 'No matches'

        : '';



  return (

    <div className="flex h-full min-h-0 flex-col">

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

          onClick={() => {

            setSearchOpen((open) => {

              const next = !open;

              if (!next) setSearchQuery('');

              return next;

            });

          }}

          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition hover:bg-white/10 hover:text-white ${

            searchOpen

              ? 'bg-white/10 text-white'

              : 'text-[var(--color-muted)]'

          }`}

          title="Search in chat (Ctrl+F)"

          aria-label="Search in chat"

        >

          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">

            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />

            <path

              d="m20 20-3-3"

              stroke="currentColor"

              strokeWidth="2"

              strokeLinecap="round"

            />

          </svg>

        </button>

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



      {searchOpen && (

        <div className="flex items-center gap-2 border-b border-black/30 bg-[var(--color-panel)] px-3 py-2">

          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg bg-[var(--color-panel-2)] px-3 py-1.5">

            <svg

              width="16"

              height="16"

              viewBox="0 0 24 24"

              fill="none"

              className="shrink-0 text-[var(--color-muted)]"

            >

              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />

              <path

                d="m20 20-3-3"

                stroke="currentColor"

                strokeWidth="2"

                strokeLinecap="round"

              />

            </svg>

            <input

              ref={searchInputRef}

              value={searchQuery}

              onChange={(e) => setSearchQuery(e.target.value)}

              onKeyDown={(e) => {

                if (e.key === 'Enter') {

                  e.preventDefault();

                  if (e.shiftKey) goToPrevMatch();

                  else goToNextMatch();

                }

              }}

              placeholder="Search messages"

              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--color-muted)]"

            />

          </div>

          {matchLabel && (

            <span className="shrink-0 text-xs text-[var(--color-muted)]">

              {matchLabel}

            </span>

          )}

          <button

            type="button"

            onClick={goToPrevMatch}

            disabled={searchMatches.length === 0}

            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--color-muted)] hover:bg-white/10 hover:text-white disabled:opacity-30"

            aria-label="Previous match"

          >

            ↑

          </button>

          <button

            type="button"

            onClick={goToNextMatch}

            disabled={searchMatches.length === 0}

            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--color-muted)] hover:bg-white/10 hover:text-white disabled:opacity-30"

            aria-label="Next match"

          >

            ↓

          </button>

          <button

            type="button"

            onClick={() => {

              setSearchOpen(false);

              setSearchQuery('');

            }}

            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--color-muted)] hover:bg-white/10 hover:text-white"

            aria-label="Close search"

          >

            ✕

          </button>

        </div>

      )}



      <div

        ref={scrollRef}

        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-4 md:px-12"

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

              const isActiveMatch =

                hasSearch &&

                searchMatches.length > 0 &&

                searchMatches[activeMatchIndex % searchMatches.length] === m.id;

              const isSearchHit = hasSearch && messageMatchesSearch(m, trimmedSearch);



              return (

                <div

                  key={m.id}

                  ref={(el) => {

                    if (el) messageRefs.current.set(m.id, el);

                    else messageRefs.current.delete(m.id);

                  }}

                  className={`rounded-lg transition-shadow ${

                    flashMessageId === m.id || isActiveMatch

                      ? 'ring-2 ring-yellow-400/70 ring-offset-2 ring-offset-[var(--color-app-bg)]'

                      : ''

                  }`}

                >

                  <Bubble

                    message={m}

                    mine={mine}

                    showSender={showSender}

                    subToUsername={subToUsername}

                    searchQuery={hasSearch && isSearchHit ? trimmedSearch : ''}

                    deleting={deleteBusyId === m.id}

                    onLayout={() => {

                      if (!entryScrollDoneRef.current) return;

                      pinToBottom();

                    }}

                    onOpenMenu={(x, y) => openMessageMenu(m, mine, x, y)}

                    onQuoteClick={

                      m.replyToMessageId

                        ? () => scrollToMessage(m.replyToMessageId!, true)

                        : undefined

                    }

                  />

                </div>

              );

            })}

          </div>

        )}

      </div>



      {actionError && (

        <p className="border-t border-black/30 bg-[var(--color-panel)] px-3 py-1.5 text-xs text-red-400">

          {actionError}

        </p>

      )}



      {messageMenu && (

        <MessageActionMenu

          menu={messageMenu}

          onReply={() => {

            setReplyTo(replyTargetFromMessage(messageMenu.message));

            setMessageMenu(null);

          }}

          onDelete={() => void handleDeleteMessage(messageMenu.message)}

        />

      )}



      <MessageComposer

        conversation={conversation}

        myUsername={myUsername}

        mySub={mySub}

        handleToSub={handleToSub}

        subToUsername={subToUsername}

        replyTo={replyTo}

        onCancelReply={() => setReplyTo(null)}

        onSent={handleMessageSent}

        onMessageCreated={onMessageCreated}

      />



      {showDetails && (

        <ChatGroupPanel

          conversation={conversation}

          myUsername={myUsername}

          mySub={mySub}

          subToUsername={subToUsername}

          onClose={() => setShowDetails(false)}

          onRenamed={(name) => {

            onConversationRenamed(name);

            setShowDetails(false);

          }}

        />

      )}

    </div>

  );

}



function HighlightedText({ text, query }: { text: string; query: string }) {

  const parts = splitBySearchQuery(text, query);

  return (

    <>

      {parts.map((part, i) =>

        part.highlight ? (

          <mark

            key={i}

            className="rounded bg-yellow-400/45 text-inherit"

          >

            {part.text}

          </mark>

        ) : (

          <span key={i}>{part.text}</span>

        ),

      )}

    </>

  );

}



function MessageActionMenu({

  menu,

  onReply,

  onDelete,

}: {

  menu: MessageMenuState;

  onReply: () => void;

  onDelete: () => void;

}) {

  const menuRef = useRef<HTMLDivElement>(null);



  useEffect(() => {

    const el = menuRef.current;

    if (!el) return;

    const rect = el.getBoundingClientRect();

    const maxX = window.innerWidth - rect.width - 8;

    const maxY = window.innerHeight - rect.height - 8;

    if (rect.right > window.innerWidth - 8) {

      el.style.left = `${Math.max(8, maxX)}px`;

    }

    if (rect.bottom > window.innerHeight - 8) {

      el.style.top = `${Math.max(8, maxY)}px`;

    }

  }, [menu.x, menu.y]);



  return (

    <div

      ref={menuRef}

      className="fixed z-50 min-w-[140px] overflow-hidden rounded-lg border border-white/10 bg-[var(--color-panel)] py-1 shadow-xl"

      style={{ left: menu.x, top: menu.y }}

      onPointerDown={(e) => e.stopPropagation()}

    >

      <button

        type="button"

        onClick={onReply}

        className="flex w-full px-4 py-2.5 text-left text-sm hover:bg-white/10"

      >

        Reply

      </button>

      {menu.mine && (

        <button

          type="button"

          onClick={onDelete}

          className="flex w-full px-4 py-2.5 text-left text-sm text-red-400 hover:bg-white/10"

        >

          Delete

        </button>

      )}

    </div>

  );

}



function Bubble({

  message,

  mine,

  showSender,

  subToUsername,

  searchQuery,

  deleting,

  onLayout,

  onOpenMenu,

  onQuoteClick,

}: {

  message: MessageModel;

  mine: boolean;

  showSender: boolean;

  subToUsername: Map<string, string>;

  searchQuery: string;

  deleting?: boolean;

  onLayout?: () => void;

  onOpenMenu: (x: number, y: number) => void;

  onQuoteClick?: () => void;

}) {

  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const longPressTriggeredRef = useRef(false);



  function clearLongPress() {

    if (longPressTimerRef.current) {

      clearTimeout(longPressTimerRef.current);

      longPressTimerRef.current = null;

    }

  }



  function startLongPress(clientX: number, clientY: number) {

    clearLongPress();

    longPressTriggeredRef.current = false;

    longPressTimerRef.current = setTimeout(() => {

      longPressTriggeredRef.current = true;

      onOpenMenu(clientX, clientY);

      navigator.vibrate?.(12);

    }, 480);

  }



  function handleContextMenu(e: React.MouseEvent) {

    e.preventDefault();

    onOpenMenu(e.clientX, e.clientY);

  }



  return (

    <div className={`flex ${mine ? 'justify-end' : 'justify-start'} ${deleting ? 'opacity-50' : ''}`}>

      <div

        className="max-w-[80%] rounded-lg px-2.5 py-1.5 text-[15px] shadow-sm"

        style={{

          backgroundColor: mine

            ? 'var(--color-bubble-out)'

            : 'var(--color-bubble-in)',

        }}

        onContextMenu={handleContextMenu}

        onTouchStart={(e) => {

          const touch = e.touches[0];

          if (touch) startLongPress(touch.clientX, touch.clientY);

        }}

        onTouchEnd={clearLongPress}

        onTouchCancel={clearLongPress}

        onTouchMove={clearLongPress}

      >

        {showSender && (

          <p

            className="mb-0.5 text-xs font-semibold"

            style={{ color: 'var(--color-accent)' }}

          >

            {participantDisplayName(message.senderUsername, subToUsername)}

          </p>

        )}

        {message.replyToMessageId && message.replyToContentPreview && (

          <button

            type="button"

            onClick={onQuoteClick}

            className="mb-1.5 w-full rounded border-l-4 border-[var(--color-accent)] bg-black/20 px-2 py-1 text-left transition hover:bg-black/30"

          >

            <p className="text-xs font-semibold text-[var(--color-accent)]">

              {participantDisplayName(

                message.replyToSenderUsername ?? '',

                subToUsername,

              )}

            </p>

            <p className="truncate text-xs text-white/70">

              {searchQuery ? (

                <HighlightedText

                  text={message.replyToContentPreview}

                  query={searchQuery}

                />

              ) : (

                message.replyToContentPreview

              )}

            </p>

          </button>

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

          <p className="whitespace-pre-wrap break-words text-left">

            {searchQuery ? (

              <HighlightedText text={message.content} query={searchQuery} />

            ) : (

              message.content

            )}

          </p>

        )}

        <div

          className={`mt-0.5 flex items-center gap-2 ${mine ? 'justify-start' : 'justify-end'}`}

        >

          <button

            type="button"

            onClick={(e) => {

              if (longPressTriggeredRef.current) {

                longPressTriggeredRef.current = false;

                return;

              }

              onOpenMenu(e.clientX, e.clientY - 48);

            }}

            className="text-[10px] font-medium text-[var(--color-accent)] hover:underline"

            aria-label="Message actions"

          >

            ···

          </button>

          <span className="text-[10px] text-white/50">

            {formatTime(message.createdAt)}

          </span>

        </div>

      </div>

    </div>

  );

}


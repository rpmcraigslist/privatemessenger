export const LOGIN_DOMAIN = '@messenger.local';

/** Lower-case handle for comparisons and Cognito preferred_username. */
export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

/** Cognito sign-in username (Amplify Gen 2 requires email-shaped login). */
export function toLoginId(username: string): string {
  return `${normalizeUsername(username)}${LOGIN_DOMAIN}`;
}

export function fromLoginId(loginId: string): string {
  return loginId.replace(/@messenger\.local$/i, '');
}

/** Cognito internal username/sub shape — not a user handle. */
export function isCognitoUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

/** Best-effort handle from Cognito user attributes in the browser. */
export function usernameFromAttributes(attrs: {
  preferred_username?: string;
  email?: string;
}): string | null {
  if (attrs.preferred_username) {
    const handle = normalizeUsername(attrs.preferred_username);
    if (!isCognitoUuid(handle)) return handle;
  }
  if (attrs.email?.toLowerCase().endsWith(LOGIN_DOMAIN)) {
    return normalizeUsername(fromLoginId(attrs.email));
  }
  return null;
}

/** Cognito login id stored in Conversation/Message owner fields (matches cognito:username). */
export function toParticipantLoginId(username: string): string {
  return toLoginId(fromLoginId(username));
}

/** True if a participant entry matches a login id (supports legacy bare usernames). */
export function participantMatchesLoginId(
  participant: string,
  loginId: string,
): boolean {
  const a = participant.toLowerCase();
  const b = loginId.toLowerCase();
  if (a === b) return true;
  return a === participantHandle(b);
}

export function graphqlErrorMessage(err: unknown, fallback: string): string {
  if (typeof err === 'object' && err && 'errors' in err) {
    const errors = (err as { errors?: { message?: string }[] }).errors;
    if (errors?.length) return errors.map((e) => e.message ?? fallback).join('; ');
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/** Bare handle from a login id or bare username. */
export function participantHandle(value: string): string {
  return normalizeUsername(fromLoginId(value));
}

export function isValidUsername(value: string): boolean {
  const u = normalizeUsername(value);
  return /^[a-z0-9._-]{3,32}$/.test(u);
}

/** Cognito sub or other internal id — never show in the UI. */
export function isInternalUserId(value: string | null | undefined): boolean {
  if (!value) return true;
  if (isCognitoUuid(value)) return true;
  return !isValidUsername(normalizeUsername(fromLoginId(value)));
}

/** Valid messenger handle, or null when value is an internal id. */
export function normalizeProfileHandle(
  value: string | null | undefined,
): string | null {
  if (isInternalUserId(value)) return null;
  return normalizeUsername(fromLoginId(value!));
}

function profileDirectoryScore(
  profile: { username: string; cognitoSub?: string | null },
): number {
  let score = 0;
  if (normalizeProfileHandle(profile.username)) score += 2;
  if (profile.cognitoSub) score += 4;
  return score;
}

function pickPreferredProfile<
  T extends { username: string; cognitoSub?: string | null },
>(existing: T, incoming: T): T {
  return profileDirectoryScore(incoming) > profileDirectoryScore(existing)
    ? incoming
    : existing;
}

/** One directory row per username; prefer signed-in profiles with valid handles. */
export function dedupeUserProfiles<
  T extends { username: string; cognitoSub?: string | null },
>(profiles: T[]): T[] {
  const byHandle = new Map<string, T>();

  for (const profile of profiles) {
    const handle = normalizeProfileHandle(profile.username);
    if (!handle) continue;
    if (profile.cognitoSub && profile.username === profile.cognitoSub) {
      continue;
    }

    byHandle.set(
      handle,
      byHandle.has(handle)
        ? pickPreferredProfile(byHandle.get(handle)!, profile)
        : profile,
    );
  }

  return [...byHandle.values()];
}

export function usernameError(value: string): string | null {
  const u = normalizeUsername(value);
  if (u.length < 3) return 'Username must be at least 3 characters.';
  if (u.length > 32) return 'Username must be 32 characters or fewer.';
  if (!/^[a-z0-9._-]+$/.test(u)) {
    return 'Use letters, numbers, dots, underscores, or hyphens only.';
  }
  return null;
}

/** Normalize optional phone to E.164 (+…). Returns null if empty or invalid. */
export function normalizePhone(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const compact = trimmed.replace(/[\s().-]/g, '');
  if (/^\+\d{10,15}$/.test(compact)) return compact;

  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length >= 10 && digits.length <= 15) return `+${digits}`;

  return null;
}

/** Friendly display for a stored E.164 number. */
export function formatPhoneDisplay(value: string | null | undefined): string {
  if (!value) return '';
  const digits = value.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    const area = digits.slice(1, 4);
    const prefix = digits.slice(4, 7);
    const line = digits.slice(7, 11);
    return `(${area}) ${prefix}-${line}`;
  }
  return value;
}

export function phoneError(value: string): string | null {
  if (!value.trim()) return null;
  if (normalizePhone(value)) return null;
  return 'Could not read that phone number. Try 10 digits or include country code.';
}

/** Normalize optional contact email. Returns null if empty or invalid. */
export function normalizeContactEmail(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed.endsWith(LOGIN_DOMAIN)) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed;
}

export function contactEmailError(value: string): string | null {
  if (!value.trim()) return null;
  if (normalizeContactEmail(value)) return null;
  return 'Enter a valid email address (not your messenger login id).';
}

export function mapAuthError(err: unknown): string {
  const name =
    typeof err === 'object' && err && 'name' in err
      ? String((err as { name: string }).name)
      : '';
  const message =
    typeof err === 'object' && err && 'message' in err
      ? String((err as { message: string }).message)
      : 'Something went wrong.';

  if (name === 'UserAlreadyAuthenticatedException') {
    return 'There is already a signed in user. Sign out first, or use a separate browser profile.';
  }
  if (name === 'UsernameExistsException') {
    return 'That username is already in use.';
  }
  if (name === 'UserNotFoundException' || name === 'NotAuthorizedException') {
    return 'Wrong username or password.';
  }
  if (name === 'InvalidPasswordException') {
    return 'Password must be 8+ chars with upper, lower, number, and symbol.';
  }
  return message;
}

const AVATAR_COLORS = [
  '#e57373', '#f06292', '#ba68c8', '#9575cd', '#7986cb',
  '#64b5f6', '#4fc3f7', '#4dd0e1', '#4db6ac', '#81c784',
  '#aed581', '#ffb74d', '#ff8a65', '#a1887f', '#90a4ae',
];

export function colorForKey(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = key.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function initials(value: string): string {
  const name = fromLoginId(value);
  const parts = name.split(/[.\-_\s]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** Never show Cognito internal UUIDs in the UI. */
export function formatUserHandle(handle: string | null | undefined): string {
  return normalizeProfileHandle(handle) ?? 'your account';
}

/** First usable messenger handle from several candidates. */
export function pickUserHandle(
  ...candidates: (string | null | undefined)[]
): string {
  for (const candidate of candidates) {
    const handle = normalizeProfileHandle(candidate);
    if (handle) return handle;
  }
  return 'user';
}

export function displayName(username: string): string {
  const handle = normalizeProfileHandle(username);
  if (!handle) return 'User';
  return handle
    .split(/[.\-_]+/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join(' ');
}

/** Safe directory / profile label (never shows Cognito subs). */
export function profileDisplayLabel(
  username: string | null | undefined,
  displayNameValue?: string | null,
): string {
  const handle = normalizeProfileHandle(username);
  const cleanTitle = normalizeProfileHandle(displayNameValue);
  if (cleanTitle) return displayName(cleanTitle);
  if (handle) return displayName(handle);
  return 'User';
}

/** Map participant ids (sub, login id, handle) to bare handles for display. */
export function buildParticipantDirectory(
  profiles: { username: string; cognitoSub?: string | null }[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const profile of profiles) {
    const handle = normalizeProfileHandle(profile.username);
    if (!handle) continue;
    if (profile.cognitoSub) map.set(profile.cognitoSub, handle);
    map.set(toLoginId(handle), handle);
    map.set(handle, handle);
  }
  return map;
}

/** Reverse of buildParticipantDirectory: bare handle → Cognito sub. */
export function buildHandleToSubDirectory(
  profiles: { username: string; cognitoSub?: string | null }[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const profile of profiles) {
    const handle = normalizeProfileHandle(profile.username);
    if (!handle || !profile.cognitoSub || !isCognitoUuid(profile.cognitoSub)) {
      continue;
    }
    map.set(handle, profile.cognitoSub);
  }
  return map;
}

/** Normalize conversation participant ids to Cognito subs for owner auth. */
export function repairParticipantSubs(
  participants: string[],
  myUsername: string,
  mySub: string,
  handleToSub: Map<string, string>,
): string[] {
  const mapped = participants
    .filter((participant): participant is string => !!participant)
    .map((participant) =>
      resolveParticipantSub(participant, myUsername, mySub, handleToSub),
    );
  return [...new Set(mapped)];
}

/** Like repairParticipantSubs, but fails when any participant is not a Cognito sub. */
export function ensureParticipantSubs(
  participants: string[],
  myUsername: string,
  mySub: string,
  handleToSub: Map<string, string>,
): string[] {
  const subs = repairParticipantSubs(participants, myUsername, mySub, handleToSub);
  const unresolved = subs.filter((sub) => !isCognitoUuid(sub));
  if (unresolved.length > 0) {
    throw new Error(
      'Could not resolve everyone in this chat. Reopen the app and try again.',
    );
  }
  return subs;
}

export type ConversationLike = {
  id: string;
  isGroup?: boolean | null;
  participants: (string | null)[];
};

/** Stable key for a 1:1 chat after resolving legacy participant ids. */
export function directConversationPeerKey(
  conversation: ConversationLike,
  myUsername: string,
  mySub: string,
  handleToSub: Map<string, string>,
): string | null {
  if (conversation.isGroup) return null;
  const subs = repairParticipantSubs(
    conversation.participants.filter((participant): participant is string => !!participant),
    myUsername,
    mySub,
    handleToSub,
  );
  if (subs.length !== 2) return null;
  return subs.slice().sort().join(':');
}

/** Keep one 1:1 thread per person; prefer the conversation with latest activity. */
export function dedupeDirectConversations<T extends ConversationLike>(
  conversations: T[],
  activityAt: (conversation: T) => string,
  myUsername: string,
  mySub: string,
  handleToSub: Map<string, string>,
): T[] {
  const bestByPeer = new Map<string, T>();

  for (const conversation of conversations) {
    if (conversation.isGroup) continue;
    const key = directConversationPeerKey(
      conversation,
      myUsername,
      mySub,
      handleToSub,
    );
    if (!key) continue;

    const existing = bestByPeer.get(key);
    if (
      !existing ||
      new Date(activityAt(conversation)).getTime() >
        new Date(activityAt(existing)).getTime()
    ) {
      bestByPeer.set(key, conversation);
    }
  }

  const keptDirectIds = new Set(
    [...bestByPeer.values()].map((conversation) => conversation.id),
  );

  return conversations.filter((conversation) => {
    if (conversation.isGroup) return true;
    const key = directConversationPeerKey(
      conversation,
      myUsername,
      mySub,
      handleToSub,
    );
    if (!key) return true;
    return keptDirectIds.has(conversation.id);
  });
}

/** Map every conversation id (including hidden duplicates) to the id shown in the UI. */
export function buildCanonicalConversationIdMap<T extends ConversationLike>(
  conversations: T[],
  activityAt: (conversation: T) => string,
  myUsername: string,
  mySub: string,
  handleToSub: Map<string, string>,
): Map<string, string> {
  const visible = dedupeDirectConversations(
    conversations,
    activityAt,
    myUsername,
    mySub,
    handleToSub,
  );
  const visibleIds = new Set(visible.map((conversation) => conversation.id));
  const map = new Map<string, string>();

  for (const conversation of conversations) {
    if (visibleIds.has(conversation.id) || conversation.isGroup) {
      map.set(conversation.id, conversation.id);
      continue;
    }

    const key = directConversationPeerKey(
      conversation,
      myUsername,
      mySub,
      handleToSub,
    );
    if (!key) {
      map.set(conversation.id, conversation.id);
      continue;
    }

    const canonical = visible.find(
      (candidate) =>
        !candidate.isGroup &&
        directConversationPeerKey(candidate, myUsername, mySub, handleToSub) ===
          key,
    );
    map.set(conversation.id, canonical?.id ?? conversation.id);
  }

  return map;
}

function resolveParticipantSub(
  participant: string,
  myUsername: string,
  mySub: string,
  handleToSub: Map<string, string>,
): string {
  if (isCognitoUuid(participant)) return participant;

  const value = participant.toLowerCase();
  const handle = myUsername.toLowerCase();
  const loginId = toLoginId(myUsername).toLowerCase();
  if (
    value === mySub.toLowerCase() ||
    value === handle ||
    value === loginId
  ) {
    return mySub;
  }

  const bareHandle = normalizeProfileHandle(participant);
  if (bareHandle && handleToSub.has(bareHandle)) {
    return handleToSub.get(bareHandle)!;
  }

  return participant;
}

export function resolveParticipantHandle(
  participant: string,
  subToUsername: Map<string, string>,
): string {
  return (
    subToUsername.get(participant) ??
    normalizeProfileHandle(participant) ??
    participant
  );
}

export function participantDisplayName(
  participant: string,
  subToUsername: Map<string, string>,
): string {
  const mapped = subToUsername.get(participant);
  if (mapped) return displayName(mapped);
  const handle = normalizeProfileHandle(participant);
  if (handle) return displayName(handle);
  return 'User';
}

function collectSelfIdentityAliases(
  myUsername: string,
  mySub: string,
  subToUsername: Map<string, string>,
  participantIds: Iterable<string> = [],
): Set<string> {
  const myHandle = normalizeUsername(myUsername);
  const aliases = new Set<string>();

  const add = (value: string | null | undefined) => {
    if (!value?.trim()) return;
    aliases.add(value.trim().toLowerCase());
    const handle = normalizeProfileHandle(value);
    if (handle) aliases.add(handle);
    const fromLogin = normalizeUsername(fromLoginId(value));
    if (isValidUsername(fromLogin)) aliases.add(fromLogin);
  };

  add(mySub);
  add(myHandle);
  add(toLoginId(myHandle));

  for (const [key, handle] of subToUsername) {
    if (normalizeUsername(handle) === myHandle) add(key);
  }

  for (const participantId of participantIds) {
    add(participantId);
  }

  return aliases;
}

export function isSameMessengerUser(
  left: string,
  myUsername: string,
  mySub: string,
  subToUsername: Map<string, string>,
  participantIds?: Iterable<string>,
): boolean {
  if (!left?.trim()) return false;

  const aliases = collectSelfIdentityAliases(
    myUsername,
    mySub,
    subToUsername,
    participantIds ?? [],
  );
  const leftNorm = left.trim().toLowerCase();
  if (aliases.has(leftNorm)) return true;

  const leftHandle = normalizeUsername(
    resolveParticipantHandle(left, subToUsername),
  );
  return aliases.has(leftHandle) || leftHandle === normalizeUsername(myUsername);
}

/** Fast path for the signed-in user's common sender id forms. */
export function matchesSelfSender(
  senderUsername: string | null | undefined,
  myUsername: string,
  mySub: string,
): boolean {
  if (!senderUsername?.trim()) return false;
  const sender = senderUsername.trim().toLowerCase();
  const handle = normalizeUsername(myUsername);
  const sub = mySub.trim().toLowerCase();
  if (!handle && !sub) return false;
  if (sub && sender === sub) return true;
  if (handle && sender === handle) return true;
  if (handle && sender === toLoginId(handle)) return true;
  const senderHandle = normalizeUsername(fromLoginId(sender));
  return !!handle && isValidUsername(senderHandle) && senderHandle === handle;
}

/** Whether a message was sent by the signed-in user (handles legacy sender ids). */
export function isMessageFromSelf(
  senderUsername: string,
  myUsername: string,
  mySub: string,
  subToUsername: Map<string, string>,
  handleToSub: Map<string, string>,
  conversation: {
    isGroup?: boolean | null;
    participants: (string | null)[];
  },
): boolean {
  const participants = conversation.participants.filter(
    (participant): participant is string => !!participant,
  );

  if (matchesSelfSender(senderUsername, myUsername, mySub)) {
    return true;
  }

  if (
    isSameMessengerUser(
      senderUsername,
      myUsername,
      mySub,
      subToUsername,
    )
  ) {
    return true;
  }

  const resolvedSender = resolveParticipantSub(
    senderUsername,
    myUsername,
    mySub,
    handleToSub,
  );
  if (resolvedSender.toLowerCase() === mySub.toLowerCase()) {
    return true;
  }

  for (const participant of participants) {
    if (participant.trim().toLowerCase() !== senderUsername.trim().toLowerCase()) {
      continue;
    }
    if (
      isSameMessengerUser(
        participant,
        myUsername,
        mySub,
        subToUsername,
      )
    ) {
      return true;
    }
    const resolvedParticipant = resolveParticipantSub(
      participant,
      myUsername,
      mySub,
      handleToSub,
    );
    if (resolvedParticipant.toLowerCase() === mySub.toLowerCase()) {
      return true;
    }
  }

  if (conversation.isGroup || participants.length !== 2) {
    return false;
  }

  const senderNorm = senderUsername.trim().toLowerCase();
  const matchingParticipant = participants.find(
    (participant) => participant.trim().toLowerCase() === senderNorm,
  );
  const otherParticipant = participants.find(
    (participant) => participant.trim().toLowerCase() !== senderNorm,
  );

  if (matchingParticipant && otherParticipant) {
    const matchingHandle = normalizeUsername(
      resolveParticipantHandle(matchingParticipant, subToUsername),
    );
    const otherHandle = normalizeUsername(
      resolveParticipantHandle(otherParticipant, subToUsername),
    );
    const myHandle = normalizeUsername(myUsername);

    const participantIsSelf = (participant: string) =>
      isSameMessengerUser(participant, myUsername, mySub, subToUsername) ||
      resolveParticipantSub(participant, myUsername, mySub, handleToSub)
        .toLowerCase() === mySub.toLowerCase();

    const matchingIsSelf = participantIsSelf(matchingParticipant);
    const otherIsSelf = participantIsSelf(otherParticipant);

    if (matchingIsSelf) return true;
    if (otherIsSelf && matchingHandle !== myHandle) return false;
    if (!otherIsSelf && otherHandle !== myHandle) return true;
  }

  const peerParticipant = participants.find(
    (participant) =>
      !isSameMessengerUser(
        participant,
        myUsername,
        mySub,
        subToUsername,
      ) &&
      resolveParticipantSub(
        participant,
        myUsername,
        mySub,
        handleToSub,
      ).toLowerCase() !== mySub.toLowerCase(),
  );
  if (!peerParticipant) return false;

  if (senderNorm === peerParticipant.trim().toLowerCase()) {
    return false;
  }

  const peerHandle = normalizeUsername(
    resolveParticipantHandle(peerParticipant, subToUsername),
  );
  const senderHandle = normalizeUsername(
    resolveParticipantHandle(senderUsername, subToUsername),
  );
  if (senderHandle === peerHandle) return false;

  const peerSub = handleToSub.get(peerHandle) ?? '';
  if (
    isSameMessengerUser(
      senderUsername,
      peerHandle,
      peerSub,
      subToUsername,
    )
  ) {
    return false;
  }

  return isCognitoUuid(senderUsername.trim());
}

export function formatTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function formatListTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return formatTime(iso);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'numeric', day: 'numeric', year: '2-digit' });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** One-line preview for conversation list rows. */
export function messageListPreview(message: {
  content?: string | null;
  type?: string | null;
  attachmentName?: string | null;
}): string {
  const body = message.content?.trim();
  if (body) return body.slice(0, 120);
  if (message.type === 'image') return '📷 Photo';
  if (message.attachmentName) return `📎 ${message.attachmentName}`.slice(0, 120);
  return '📎 Attachment';
}

const REPLY_PREVIEW_MAX = 200;

/** Truncated text shown when quoting a message in a reply. */
export function messageReplyPreview(message: {
  content?: string | null;
  type?: string | null;
  attachmentName?: string | null;
}): string {
  return messageListPreview(message).slice(0, REPLY_PREVIEW_MAX);
}

export function messageMatchesSearch(
  message: {
    content?: string | null;
    attachmentName?: string | null;
    replyToContentPreview?: string | null;
  },
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  const haystack = [
    message.content,
    message.attachmentName,
    message.replyToContentPreview,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}

export function splitBySearchQuery(
  text: string,
  query: string,
): { text: string; highlight: boolean }[] {
  const q = query.trim();
  if (!q) return [{ text, highlight: false }];

  const lower = text.toLowerCase();
  const qLower = q.toLowerCase();
  const parts: { text: string; highlight: boolean }[] = [];
  let start = 0;
  let idx = lower.indexOf(qLower, start);

  while (idx !== -1) {
    if (idx > start) {
      parts.push({ text: text.slice(start, idx), highlight: false });
    }
    parts.push({ text: text.slice(idx, idx + q.length), highlight: true });
    start = idx + q.length;
    idx = lower.indexOf(qLower, start);
  }

  if (start < text.length) {
    parts.push({ text: text.slice(start), highlight: false });
  }

  return parts.length > 0 ? parts : [{ text, highlight: false }];
}

export type ReplyTarget = {
  messageId: string;
  senderUsername: string;
  contentPreview: string;
};

export function replyTargetFromMessage(message: {
  id: string;
  senderUsername: string;
  content?: string | null;
  type?: string | null;
  attachmentName?: string | null;
}): ReplyTarget {
  return {
    messageId: message.id,
    senderUsername: message.senderUsername,
    contentPreview: messageReplyPreview(message),
  };
}

export function conversationTitle(
  participants: (string | null)[],
  name: string | null | undefined,
  mySub: string,
  myUsername: string,
  subToUsername: Map<string, string>,
): string {
  if (name) return name;
  const others = participants.filter(
    (p): p is string =>
      !!p && !isSameMessengerUser(p, myUsername, mySub, subToUsername),
  );
  if (others.length === 0) return 'You';
  if (others.length === 1) {
    return participantDisplayName(others[0], subToUsername);
  }
  return others
    .map((p) => participantDisplayName(p, subToUsername))
    .join(', ');
}

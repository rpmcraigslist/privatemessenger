import { fromLoginId, toLoginId } from './cognito';

/** Map a legacy participant entry to the caller's Cognito sub when it matches them. */
export function participantIdForUser(
  participant: string,
  username: string,
  sub: string,
): string {
  if (participant === sub) return participant;

  const loginId = toLoginId(username);
  const value = participant.toLowerCase();
  const handle = username.toLowerCase();

  if (value === sub) return sub;
  if (value === loginId.toLowerCase()) return sub;
  if (value === handle) return sub;
  if (fromLoginId(value) === handle) return sub;

  return participant;
}

export function repairParticipantList(
  participants: (string | null | undefined)[],
  username: string,
  sub: string,
): { values: string[]; changed: boolean } {
  let changed = false;
  const mapped = participants
    .filter((p): p is string => !!p)
    .map((p) => {
      const next = participantIdForUser(p, username, sub);
      if (next !== p) changed = true;
      return next;
    });

  const deduped = [...new Set(mapped)];
  if (deduped.length !== mapped.length) changed = true;

  return { values: deduped, changed };
}

export function conversationIncludesUser(
  participants: (string | null | undefined)[],
  username: string,
  sub: string,
): boolean {
  return participants.some(
    (p) => !!p && participantIdForUser(p, username, sub) === sub,
  );
}

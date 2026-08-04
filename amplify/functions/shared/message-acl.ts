import type { Schema } from '../../data/resource';
import { fromLoginId, isCognitoUuid, toLoginId } from './cognito';

type DataClient = ReturnType<
  typeof import('aws-amplify/data').generateClient<Schema>
>;

function buildCanonicalSubMap(
  profiles: Schema['UserProfile']['type'][],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const profile of profiles) {
    const sub = profile.cognitoSub?.trim();
    if (!sub || !isCognitoUuid(sub)) continue;
    map.set(sub, sub);
    map.set(sub.toLowerCase(), sub);
    const handle = profile.username?.trim().toLowerCase();
    if (handle) {
      map.set(handle, sub);
      map.set(toLoginId(handle).toLowerCase(), sub);
    }
  }
  return map;
}

function resolveCanonicalSub(
  participant: string,
  canonical: Map<string, string>,
): string | null {
  const trimmed = participant.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  return (
    canonical.get(trimmed) ??
    canonical.get(lower) ??
    canonical.get(fromLoginId(lower)) ??
    (isCognitoUuid(trimmed) ? trimmed : null)
  );
}

/**
 * Rewrite message owner ACL from the conversation's participants so every
 * current member (by Cognito sub) can receive realtime + list updates.
 */
export async function repairMessageParticipantAcl(
  client: DataClient,
  message: Schema['Message']['type'],
): Promise<Schema['Message']['type']> {
  if (!message.conversationId) return message;

  const { data: conversation } = await client.models.Conversation.get(
    { id: message.conversationId },
    { authMode: 'iam' },
  );
  if (!conversation) return message;

  const { data: profiles } = await client.models.UserProfile.list({
    authMode: 'iam',
  });
  const canonical = buildCanonicalSubMap(profiles ?? []);

  const source = [
    ...(conversation.participants ?? []),
    ...(message.participantUsernames ?? []),
  ].filter((value): value is string => !!value);

  const next = [
    ...new Set(
      source
        .map((participant) => resolveCanonicalSub(participant, canonical))
        .filter((value): value is string => !!value),
    ),
  ].sort();

  if (next.length === 0) return message;

  const current = [...new Set(message.participantUsernames ?? [])].sort();
  if (
    current.length === next.length &&
    current.every((value, index) => value === next[index])
  ) {
    return message;
  }

  const { data: updated, errors } = await client.models.Message.update(
    {
      id: message.id,
      participantUsernames: next,
    },
    { authMode: 'iam' },
  );
  if (errors?.length) {
    console.error('repairMessageParticipantAcl failed', errors);
    return message;
  }

  return updated ?? { ...message, participantUsernames: next };
}

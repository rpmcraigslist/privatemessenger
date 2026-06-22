import type { AppSyncResolverHandler } from 'aws-lambda';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../data/resource';
import { env } from '$amplify/env/read-cursor';
import { parseIdentity } from '../shared/cognito';

type ReadCursorEvent = {
  info: { fieldName: string };
  identity: unknown;
  arguments: {
    readScopeKey?: string;
    lastReadAt?: string;
    conversationId?: string | null;
  };
};

function resolveFieldName(event: unknown): string {
  const e = event as {
    info?: { fieldName?: string };
    fieldName?: string;
  };
  const field = e.info?.fieldName ?? e.fieldName;
  if (!field) {
    throw new Error('Unknown read cursor operation');
  }
  return field;
}

function maxIsoTimestamp(
  left: string | null | undefined,
  right: string | null | undefined,
): string | null {
  if (!left) return right ?? null;
  if (!right) return left;
  const leftMs = new Date(left).getTime();
  const rightMs = new Date(right).getTime();
  if (Number.isNaN(leftMs)) return right;
  if (Number.isNaN(rightMs)) return left;
  return leftMs >= rightMs ? left : right;
}

const dataClientPromise = getAmplifyDataClientConfig(
  env as Parameters<typeof getAmplifyDataClientConfig>[0],
).then(({ resourceConfig, libraryOptions }) => {
  Amplify.configure(resourceConfig, libraryOptions);
  return generateClient<Schema>();
});

export const handler: AppSyncResolverHandler<
  ReadCursorEvent['arguments'],
  unknown
> = async (event) => {
  const field = resolveFieldName(event);
  const { sub } = parseIdentity(event.identity);
  if (!sub) {
    throw new Error('Unauthorized');
  }

  const client = await dataClientPromise;

  if (field === 'listMyReadCursors') {
    const { data, errors } = await client.models.ConversationReadState.list({
      filter: { userSub: { eq: sub } },
      authMode: 'iam',
    });
    if (errors?.length) {
      throw new Error(errors[0].message ?? 'Could not load read cursors');
    }

    return (data ?? []).map((row) => ({
      readScopeKey: row.readScopeKey,
      lastReadAt: row.lastReadAt,
      conversationId: row.conversationId ?? null,
    }));
  }

  if (field === 'upsertMyReadCursor') {
    const { readScopeKey, lastReadAt, conversationId } = event.arguments;
    if (!readScopeKey || !lastReadAt) {
      throw new Error('readScopeKey and lastReadAt are required');
    }

    const { data: existing } = await client.models.ConversationReadState.get(
      { userSub: sub, readScopeKey },
      { authMode: 'iam' },
    );

    const merged = maxIsoTimestamp(existing?.lastReadAt, lastReadAt);
    if (!merged) {
      throw new Error('Invalid lastReadAt');
    }

    if (existing?.lastReadAt) {
      if (merged === existing.lastReadAt && existing.conversationId === conversationId) {
        return {
          readScopeKey,
          lastReadAt: existing.lastReadAt,
          conversationId: existing.conversationId ?? null,
        };
      }

      const { data, errors } = await client.models.ConversationReadState.update(
        {
          userSub: sub,
          readScopeKey,
          lastReadAt: merged,
          conversationId: conversationId ?? existing.conversationId ?? undefined,
        },
        { authMode: 'iam' },
      );
      if (errors?.length || !data?.lastReadAt) {
        throw new Error(errors?.[0]?.message ?? 'Could not update read cursor');
      }
      return {
        readScopeKey: data.readScopeKey,
        lastReadAt: data.lastReadAt,
        conversationId: data.conversationId ?? null,
      };
    }

    const { data, errors } = await client.models.ConversationReadState.create(
      {
        userSub: sub,
        readScopeKey,
        lastReadAt: merged,
        conversationId: conversationId ?? undefined,
      },
      { authMode: 'iam' },
    );
    if (errors?.length || !data?.lastReadAt) {
      throw new Error(errors?.[0]?.message ?? 'Could not create read cursor');
    }
    return {
      readScopeKey: data.readScopeKey,
      lastReadAt: data.lastReadAt,
      conversationId: data.conversationId ?? null,
    };
  }

  throw new Error(`Unsupported read cursor operation: ${field}`);
};

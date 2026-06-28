import { pickUserHandle } from './util';

/**
 * Client ↔ backend contract for syncMyProfile.
 * When amplify/data/resource.ts changes, update this file and run tests.
 */
export const SYNC_PROFILE_CONTRACT = {
  mutationArgs: ['contactEmail', 'messageBubbleColor'] as const,
  resultFields: [
    'profileId',
    'username',
    'cognitoSub',
    'role',
    'contactEmail',
    'messageBubbleColor',
  ] as const,
} as const;

/** GraphQL operations the client calls — must exist in amplify_outputs.json. */
export const REQUIRED_GRAPHQL_OPERATIONS = {
  queries: [
    'listUserDirectory',
    'adminListUsers',
    'adminAuditMessenger',
    'listMyReadCursors',
    'getAttachmentUrl',
  ] as const,
  mutations: [
    'syncMyProfile',
    'deleteMyMessage',
    'adminDeleteUser',
    'adminPurgeDirectChat',
    'adminSendUserEmail',
    'sendMessageAlerts',
    'upsertMyReadCursor',
  ] as const,
} as const;

/** GraphQL result shapes for email-related operations. */
export const EMAIL_DELIVERY_CONTRACT = {
  sendMessageAlerts: {
    resultFields: [
      'sent',
      'failed',
      'skipped',
      'conversationId',
      'fromEmailConfigured',
    ] as const,
  },
  adminSendUserEmail: {
    args: ['username', 'subject', 'bodyText'] as const,
    resultFields: [
      'sent',
      'username',
      'toEmail',
      'message',
      'fromEmailConfigured',
    ] as const,
  },
} as const;

export type SyncProfileMutationArg =
  (typeof SYNC_PROFILE_CONTRACT.mutationArgs)[number];

export type SyncProfileResultField =
  (typeof SYNC_PROFILE_CONTRACT.resultFields)[number];

export type SyncProfilePayload = {
  profileId: string;
  username: string;
  cognitoSub: string;
  role: string;
  contactEmail?: string | null;
  messageBubbleColor?: string | null;
};

type OutputsIntrospection = {
  data?: {
    model_introspection?: {
      models?: Record<string, { fields?: Record<string, unknown> }>;
      queries?: Record<string, unknown>;
      mutations?: Record<
        string,
        {
          arguments?: Record<string, unknown>;
          type?: { nonModel?: string };
        }
      >;
      nonModels?: Record<string, { fields?: Record<string, unknown> }>;
    };
  };
};

/** Compare tracked amplify_outputs.json to the code contract (fails when stale). */
export function assertAmplifyOutputsMatchContract(
  outputs: OutputsIntrospection,
): string[] {
  const issues: string[] = [];
  const introspection = outputs.data?.model_introspection;
  if (!introspection) {
    issues.push('amplify_outputs.json is missing data.model_introspection');
    return issues;
  }

  const mutationArgs = Object.keys(
    introspection.mutations?.syncMyProfile?.arguments ?? {},
  );
  for (const arg of SYNC_PROFILE_CONTRACT.mutationArgs) {
    if (!mutationArgs.includes(arg)) {
      issues.push(
        `syncMyProfile is missing argument "${arg}" in amplify_outputs.json (found: ${mutationArgs.join(', ') || 'none'})`,
      );
    }
  }
  for (const arg of mutationArgs) {
    if (
      !(SYNC_PROFILE_CONTRACT.mutationArgs as readonly string[]).includes(arg)
    ) {
      issues.push(
        `syncMyProfile has stale argument "${arg}" in amplify_outputs.json`,
      );
    }
  }

  const resultFields = Object.keys(
    introspection.nonModels?.SyncProfileResult?.fields ?? {},
  );
  for (const field of SYNC_PROFILE_CONTRACT.resultFields) {
    if (!resultFields.includes(field)) {
      issues.push(
        `SyncProfileResult is missing field "${field}" in amplify_outputs.json`,
      );
    }
  }

  const profileFields = Object.keys(
    introspection.models?.UserProfile?.fields ?? {},
  );
  if (!profileFields.includes('contactEmail')) {
    issues.push('UserProfile is missing contactEmail in amplify_outputs.json');
  }
  if (!profileFields.includes('messageBubbleColor')) {
    issues.push(
      'UserProfile is missing messageBubbleColor in amplify_outputs.json',
    );
  }

  const queries = introspection.queries ?? {};
  for (const name of REQUIRED_GRAPHQL_OPERATIONS.queries) {
    if (!queries[name]) {
      issues.push(`amplify_outputs.json is missing query "${name}"`);
    }
  }

  const mutations = introspection.mutations ?? {};
  for (const name of REQUIRED_GRAPHQL_OPERATIONS.mutations) {
    if (!mutations[name]) {
      issues.push(`amplify_outputs.json is missing mutation "${name}"`);
    }
  }

  for (const [mutationName, contract] of Object.entries(EMAIL_DELIVERY_CONTRACT)) {
    const mutation = mutations[mutationName];
    if (!mutation) continue;

    const args = Object.keys(mutation.arguments ?? {});
    if ('args' in contract) {
      for (const arg of contract.args) {
        if (!args.includes(arg)) {
          issues.push(
            `${mutationName} is missing argument "${arg}" in amplify_outputs.json`,
          );
        }
      }
    }

    const resultTypeName = mutation.type?.nonModel;
    const resultFields = Object.keys(
      introspection.nonModels?.[resultTypeName ?? '']?.fields ?? {},
    );
    for (const field of contract.resultFields) {
      if (!resultFields.includes(field)) {
        issues.push(
          `${resultTypeName ?? mutationName} is missing field "${field}" in amplify_outputs.json`,
        );
      }
    }
  }

  return issues;
}

/** Map syncMyProfile GraphQL payload → SessionUser fields (pure, testable). */
export function sessionUserFromSyncProfile(
  data: SyncProfilePayload,
  resolvedHandle: string | null,
  recalledHandle: string | null,
): {
  username: string;
  cognitoSub: string;
  isAdmin: boolean;
  contactEmail: string | null;
  profileId: string | null;
  messageBubbleColor: string | null;
} {
  if (!data.cognitoSub?.trim()) {
    throw new Error('Profile sync returned no cognitoSub');
  }
  if (!data.profileId?.trim()) {
    throw new Error('Profile sync returned no profileId');
  }

  return {
    username: pickUserHandle(resolvedHandle, recalledHandle, data.username),
    cognitoSub: data.cognitoSub,
    isAdmin: data.role === 'admin',
    contactEmail: data.contactEmail ?? null,
    profileId: data.profileId,
    messageBubbleColor: data.messageBubbleColor ?? null,
  };
}

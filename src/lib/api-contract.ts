import { pickUserHandle } from './util';

/**
 * Client ↔ backend contract for syncMyProfile.
 * When amplify/data/resource.ts changes, update this file and run tests.
 */
export const SYNC_PROFILE_CONTRACT = {
  mutationArgs: ['contactEmail'] as const,
  resultFields: [
    'profileId',
    'username',
    'cognitoSub',
    'role',
    'contactEmail',
  ] as const,
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
};

type OutputsIntrospection = {
  data?: {
    model_introspection?: {
      models?: Record<string, { fields?: Record<string, unknown> }>;
      mutations?: Record<string, { arguments?: Record<string, unknown> }>;
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
  };
}

import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
  type UserType,
} from '@aws-sdk/client-cognito-identity-provider';
import type { AppSyncResolverHandler } from 'aws-lambda';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../data/resource';
import { env } from '$amplify/env/admin-ops';
import {
  fromLoginId,
  isAdminGroupMember,
  isCognitoUuid,
  poolId,
  resolveCallerIdentity,
  toLoginId,
} from '../shared/cognito';

const cognito = new CognitoIdentityProviderClient({});
const dataClientPromise = getAmplifyDataClientConfig(
  env as Parameters<typeof getAmplifyDataClientConfig>[0],
).then(({ resourceConfig, libraryOptions }) => {
  Amplify.configure(resourceConfig, libraryOptions);
  return generateClient<Schema>();
});

async function assertAdmin(identity: unknown): Promise<string> {
  const { username, sub } = await resolveCallerIdentity(identity);
  if (!sub && !username) {
    throw new Error('Unauthorized');
  }

  if (isAdminGroupMember(identity)) {
    if (!username) {
      throw new Error('Could not resolve admin username');
    }
    return username;
  }

  const client = await dataClientPromise;

  if (sub) {
    const bySub = await client.models.UserProfile.list({
      filter: { cognitoSub: { eq: sub } },
      authMode: 'iam',
    });
    const profile = bySub.data[0];
    if (profile?.role === 'admin') {
      return profile.username ?? username ?? sub;
    }
  }

  if (username) {
    const byUsername = await client.models.UserProfile.list({
      filter: { username: { eq: username } },
      authMode: 'iam',
    });
    if (byUsername.data[0]?.role === 'admin') {
      return username;
    }
  }

  throw new Error('Admin access required');
}

function mapUser(u: UserType) {
  const attrs = Object.fromEntries(
    (u.Attributes ?? []).map((a) => [a.Name!, a.Value!]),
  );
  const username =
    attrs.preferred_username ??
    (u.Username ? fromLoginId(u.Username) : 'unknown');
  return {
    loginId: u.Username ?? '',
    username,
    cognitoSub: attrs.sub ?? null,
    phoneNumber: attrs.phone_number ?? null,
    status: u.UserStatus ?? 'UNKNOWN',
  };
}

type MappedCognitoUser = ReturnType<typeof mapUser>;
type UserProfileRow = Schema['UserProfile']['type'];

async function syncProfileForCognitoUser(
  user: MappedCognitoUser,
): Promise<void> {
  const handle = user.username.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(handle) || isCognitoUuid(handle)) return;

  const client = await dataClientPromise;
  const byUsername = await client.models.UserProfile.list({
    filter: { username: { eq: handle } },
    authMode: 'iam',
  });

  const related = new Map<string, UserProfileRow>();
  for (const profile of byUsername.data) {
    related.set(profile.id, profile);
  }

  if (user.cognitoSub) {
    const bySub = await client.models.UserProfile.list({
      filter: { cognitoSub: { eq: user.cognitoSub } },
      authMode: 'iam',
    });
    for (const profile of bySub.data) {
      related.set(profile.id, profile);
    }

    const byLegacyUsername = await client.models.UserProfile.list({
      filter: { username: { eq: user.cognitoSub } },
      authMode: 'iam',
    });
    for (const profile of byLegacyUsername.data) {
      related.set(profile.id, profile);
    }
  }

  const profiles = [...related.values()];

  if (profiles.length === 0) {
    await client.models.UserProfile.create(
      {
        username: handle,
        cognitoSub: user.cognitoSub,
        displayName: handle,
        role: 'user',
        phoneNumber: user.phoneNumber?.trim() || null,
        avatarColor: '#64b5f6',
      },
      { authMode: 'iam' },
    );
    return;
  }

  const keeper =
    profiles.find((p) => p.username === handle && p.cognitoSub === user.cognitoSub) ??
    profiles.find((p) => p.username === handle && p.cognitoSub) ??
    profiles.find((p) => p.username === handle) ??
    profiles.find((p) => p.cognitoSub === user.cognitoSub) ??
    profiles[0];

  for (const profile of profiles) {
    if (profile.id !== keeper.id) {
      await client.models.UserProfile.delete(
        { id: profile.id },
        { authMode: 'iam' },
      );
    }
  }

  const rawTitle = keeper.displayName?.trim();
  const displayName =
    rawTitle && !isCognitoUuid(rawTitle) ? rawTitle : handle;

  await client.models.UserProfile.update(
    {
      id: keeper.id,
      username: handle,
      cognitoSub: user.cognitoSub ?? keeper.cognitoSub,
      displayName,
      phoneNumber: user.phoneNumber?.trim() || keeper.phoneNumber,
    },
    { authMode: 'iam' },
  );
}

function isMessageSender(
  senderUsername: string,
  callerSub: string | null,
  callerUsername: string | null,
): boolean {
  const sender = senderUsername.trim().toLowerCase();
  if (callerSub && sender === callerSub.toLowerCase()) return true;
  if (!callerUsername) return false;
  const handle = callerUsername.trim().toLowerCase();
  if (sender === handle) return true;
  if (sender === toLoginId(handle).toLowerCase()) return true;
  return fromLoginId(sender) === handle;
}

type DirectoryEntry = {
  id: string;
  username: string;
  cognitoSub: string | null;
  displayName: string;
  avatarColor: string | null;
};

async function listUserDirectory(): Promise<DirectoryEntry[]> {
  const cognitoUsers = await listUsers();
  for (const user of cognitoUsers) {
    try {
      await syncProfileForCognitoUser(user);
    } catch (err) {
      console.error('profile reconcile failed for', user.username, err);
    }
  }

  const client = await dataClientPromise;
  const profiles = await client.models.UserProfile.list({ authMode: 'iam' });
  const byUsername = new Map<
    string,
    {
      id: string;
      username: string;
      cognitoSub: string | null;
      displayName: string;
      avatarColor: string | null;
    }
  >();
  const bySub = new Map<string, (typeof byUsername extends Map<string, infer V> ? V : never)>();

  for (const profile of profiles.data) {
    if (!/^[a-z0-9._-]{3,32}$/.test(profile.username)) continue;
    if (isCognitoUuid(profile.username)) continue;
    if (profile.cognitoSub && profile.username === profile.cognitoSub) continue;
    if (!profile.cognitoSub) {
      const signedInSibling = profiles.data.find(
        (other) =>
          other.id !== profile.id &&
          other.username === profile.username &&
          other.cognitoSub,
      );
      if (signedInSibling) continue;
    }
    const rawTitle = profile.displayName?.trim();
    const displayName =
      rawTitle && !isCognitoUuid(rawTitle) ? rawTitle : profile.username;
    const entry = {
      id: profile.id,
      username: profile.username,
      cognitoSub: profile.cognitoSub ?? null,
      displayName,
      avatarColor: profile.avatarColor ?? null,
    };

    const existingByUsername = byUsername.get(profile.username);
    if (!existingByUsername || (!existingByUsername.cognitoSub && entry.cognitoSub)) {
      byUsername.set(profile.username, entry);
    }

    if (entry.cognitoSub) {
      const existingBySub = bySub.get(entry.cognitoSub);
      if (!existingBySub || (!existingBySub.cognitoSub && entry.cognitoSub)) {
        bySub.set(entry.cognitoSub, entry);
      }
    }
  }

  const seen = new Set<string>();
  const result: DirectoryEntry[] = [];

  for (const entry of bySub.values()) {
    const canonical = byUsername.get(entry.username) ?? entry;
    const key = entry.cognitoSub!;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(canonical);
  }

  for (const entry of byUsername.values()) {
    const key = entry.cognitoSub ?? entry.username;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }

  const onePerUsername = new Map<string, DirectoryEntry>();
  for (const entry of result) {
    const existing = onePerUsername.get(entry.username);
    if (!existing || (!existing.cognitoSub && entry.cognitoSub)) {
      onePerUsername.set(entry.username, entry);
    }
  }

  return [...onePerUsername.values()];
}

async function ensureProfileStub(
  handle: string,
  phoneNumber?: string | null,
): Promise<void> {
  const client = await dataClientPromise;
  const existing = await client.models.UserProfile.list({
    filter: { username: { eq: handle } },
    authMode: 'iam',
  });
  if (existing.data.length > 0) return;

  await client.models.UserProfile.create(
    {
      username: handle,
      displayName: handle,
      role: 'user',
      phoneNumber: phoneNumber?.trim() || null,
      avatarColor: '#64b5f6',
    },
    { authMode: 'iam' },
  );
}

async function listUsers() {
  const users: ReturnType<typeof mapUser>[] = [];
  let token: string | undefined;
  do {
    const res = await cognito.send(
      new ListUsersCommand({
        UserPoolId: poolId(),
        PaginationToken: token,
        Limit: 60,
      }),
    );
    users.push(...(res.Users ?? []).map(mapUser));
    token = res.PaginationToken;
  } while (token);
  return users;
}

type AdminEvent = {
  info: { fieldName: string };
  identity: unknown;
  arguments: {
    username?: string;
    temporaryPassword?: string;
    phoneNumber?: string | null;
    forcePasswordChange?: boolean | null;
    messageId?: string;
  };
};

function resolveFieldName(event: unknown): string {
  const e = event as {
    info?: { fieldName?: string };
    fieldName?: string;
  };
  const field = e.info?.fieldName ?? e.fieldName;
  if (!field) {
    throw new Error('Unknown admin operation');
  }
  return field;
}

export const handler: AppSyncResolverHandler<AdminEvent['arguments'], unknown> =
  async (event) => {
  const field = resolveFieldName(event);

  if (field === 'listUserDirectory') {
    const { username, sub } = await resolveCallerIdentity(event.identity);
    if (!username && !sub) throw new Error('Unauthorized');
    return listUserDirectory();
  }

  if (field === 'deleteMyMessage') {
    const messageId = event.arguments.messageId;
    if (!messageId) throw new Error('messageId is required');

    const { username, sub } = await resolveCallerIdentity(event.identity);
    if (!sub) throw new Error('Unauthorized');

    const client = await dataClientPromise;
    const { data: message } = await client.models.Message.get(
      { id: messageId },
      { authMode: 'iam' },
    );
    if (!message) throw new Error('Message not found');

    if (!isMessageSender(message.senderUsername, sub, username)) {
      throw new Error('You can only delete your own messages');
    }

    await client.models.Message.delete({ id: messageId }, { authMode: 'iam' });
    return { messageId, deleted: true };
  }

  const actor = await assertAdmin(event.identity);

  switch (field) {
    case 'adminListUsers':
      return listUsers();
    case 'adminCreateUser': {
      const { username, temporaryPassword, phoneNumber, forcePasswordChange } =
        event.arguments;
      if (!username || !temporaryPassword) {
        throw new Error('username and temporaryPassword are required');
      }
      const handle = username.trim().toLowerCase();
      const loginId = toLoginId(handle);
      const attrs = [
        { Name: 'preferred_username', Value: handle },
        { Name: 'email', Value: loginId },
        { Name: 'email_verified', Value: 'true' },
      ];
      if (phoneNumber?.trim()) {
        attrs.push(
          { Name: 'phone_number', Value: phoneNumber.trim() },
          { Name: 'phone_number_verified', Value: 'true' },
        );
      }

      await cognito.send(
        new AdminCreateUserCommand({
          UserPoolId: poolId(),
          Username: loginId,
          TemporaryPassword: temporaryPassword,
          MessageAction: 'SUPPRESS',
          UserAttributes: attrs,
        }),
      );

      if (forcePasswordChange === false) {
        await cognito.send(
          new AdminSetUserPasswordCommand({
            UserPoolId: poolId(),
            Username: loginId,
            Password: temporaryPassword,
            Permanent: true,
          }),
        );
      }

      await ensureProfileStub(handle, phoneNumber);

      const createdUsers = await listUsers();
      const created = createdUsers.find((u) => u.username === handle);
      if (created) {
        await syncProfileForCognitoUser(created);
      }

      return {
        username: handle,
        forcePasswordChange: forcePasswordChange !== false,
      };
    }
    case 'adminDeleteUser': {
      const username = event.arguments.username;
      if (!username) throw new Error('username is required');
      const handle = username.trim().toLowerCase();
      if (handle === actor) {
        throw new Error('You cannot delete your own account while signed in.');
      }
      await cognito.send(
        new AdminDeleteUserCommand({
          UserPoolId: poolId(),
          Username: toLoginId(handle),
        }),
      );
      const client = await dataClientPromise;
      const profiles = await client.models.UserProfile.list({
        filter: { username: { eq: handle } },
        authMode: 'iam',
      });
      for (const p of profiles.data) {
        await client.models.UserProfile.delete({ id: p.id }, { authMode: 'iam' });
      }
      return { username: handle };
    }
    case 'adminForcePasswordChange': {
      const { username, temporaryPassword } = event.arguments;
      if (!username || !temporaryPassword) {
        throw new Error('username and temporaryPassword are required');
      }
      const handle = username.trim().toLowerCase();
      await cognito.send(
        new AdminSetUserPasswordCommand({
          UserPoolId: poolId(),
          Username: toLoginId(handle),
          Password: temporaryPassword,
          Permanent: false,
        }),
      );

      const users = await listUsers();
      const target = users.find((u) => u.username === handle);
      if (target) {
        await syncProfileForCognitoUser(target);
      }

      return {
        username: handle,
        message: `${handle} must change password on next sign-in.`,
      };
    }
    case 'adminPurgeUsers': {
      const users = await listUsers();
      let deleted = 0;
      for (const u of users) {
        if (u.username === actor) continue;
        await cognito.send(
          new AdminDeleteUserCommand({
            UserPoolId: poolId(),
            Username: u.loginId,
          }),
        );
        deleted++;
      }
      const client = await dataClientPromise;
      const profiles = await client.models.UserProfile.list({ authMode: 'iam' });
      for (const p of profiles.data) {
        if (p.username === actor) continue;
        await client.models.UserProfile.delete({ id: p.id }, { authMode: 'iam' });
      }
      return { deleted };
    }
    case 'adminClearMessages': {
      const client = await dataClientPromise;
      let deletedMessages = 0;
      let deletedConversations = 0;
      const messages = await client.models.Message.list({ authMode: 'iam' });
      for (const m of messages.data) {
        await client.models.Message.delete({ id: m.id }, { authMode: 'iam' });
        deletedMessages++;
      }
      const conversations = await client.models.Conversation.list({
        authMode: 'iam',
      });
      for (const c of conversations.data) {
        await client.models.Conversation.delete({ id: c.id }, { authMode: 'iam' });
        deletedConversations++;
      }
      return { deletedMessages, deletedConversations };
    }
    default:
      throw new Error(`Unknown admin operation: ${field}`);
  }
};

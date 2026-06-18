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
import { callerUsername, fromLoginId, isAdminGroupMember, parseIdentity, poolId, toLoginId } from '../shared/cognito';

const cognito = new CognitoIdentityProviderClient({});
const dataClientPromise = getAmplifyDataClientConfig(
  env as Parameters<typeof getAmplifyDataClientConfig>[0],
).then(({ resourceConfig, libraryOptions }) => {
  Amplify.configure(resourceConfig, libraryOptions);
  return generateClient<Schema>();
});

async function assertAdmin(identity: unknown): Promise<string> {
  const { username } = parseIdentity(identity);
  if (!username) throw new Error('Unauthorized');

  if (isAdminGroupMember(identity)) {
    return username;
  }

  const client = await dataClientPromise;
  const profiles = await client.models.UserProfile.list({
    filter: { username: { eq: username } },
    authMode: 'iam',
  });

  if (profiles.data[0]?.role !== 'admin') {
    throw new Error('Admin access required');
  }
  return username;
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
    phoneNumber: attrs.phone_number ?? null,
    status: u.UserStatus ?? 'UNKNOWN',
  };
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

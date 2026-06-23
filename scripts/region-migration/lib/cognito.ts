import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
  ListUsersInGroupCommand,
  type AttributeType,
} from '@aws-sdk/client-cognito-identity-provider';
import type { ExportedCognitoUser, SubRemap } from './types.js';

const LOGIN_DOMAIN = '@messenger.local';

function toLoginId(username: string): string {
  return `${username.trim().toLowerCase()}${LOGIN_DOMAIN}`;
}

function fromLoginId(loginId: string): string {
  return loginId.replace(/@messenger\.local$/i, '').toLowerCase();
}

function attrMap(attributes: AttributeType[] | undefined): Record<string, string> {
  return Object.fromEntries(
    (attributes ?? [])
      .filter((entry) => entry.Name && entry.Value)
      .map((entry) => [entry.Name!, entry.Value!]),
  );
}

export async function exportCognitoUsers(
  region: string,
  userPoolId: string,
): Promise<ExportedCognitoUser[]> {
  const client = new CognitoIdentityProviderClient({ region });
  const adminSubs = new Set<string>();
  let paginationToken: string | undefined;

  do {
    const admins = await client.send(
      new ListUsersInGroupCommand({
        UserPoolId: userPoolId,
        GroupName: 'Admin',
        NextToken: paginationToken,
      }),
    );
    for (const user of admins.Users ?? []) {
      const sub = attrMap(user.Attributes).sub;
      if (sub) adminSubs.add(sub);
    }
    paginationToken = admins.NextToken;
  } while (paginationToken);

  const users: ExportedCognitoUser[] = [];
  paginationToken = undefined;

  do {
    const page = await client.send(
      new ListUsersCommand({
        UserPoolId: userPoolId,
        PaginationToken: paginationToken,
      }),
    );
    for (const user of page.Users ?? []) {
      const attrs = attrMap(user.Attributes);
      const loginId = user.Username ?? '';
      const username =
        attrs.preferred_username ?? (loginId ? fromLoginId(loginId) : 'unknown');
      users.push({
        loginId,
        username,
        oldSub: attrs.sub ?? '',
        email: attrs.email ?? null,
        contactEmail: attrs.email ?? null,
        isAdmin: adminSubs.has(attrs.sub ?? ''),
        enabled: user.Enabled ?? true,
      });
    }
    paginationToken = page.PaginationToken;
  } while (paginationToken);

  return users.filter((user) => user.oldSub && user.loginId);
}

export async function importCognitoUsers(
  region: string,
  userPoolId: string,
  users: ExportedCognitoUser[],
  temporaryPassword: string,
): Promise<SubRemap> {
  const client = new CognitoIdentityProviderClient({ region });
  const subRemap: SubRemap = new Map();

  for (const user of users) {
    if (!user.enabled) continue;

    const loginId = user.loginId || toLoginId(user.username);
    const attributes: AttributeType[] = [
      { Name: 'preferred_username', Value: user.username },
    ];
    if (user.email) {
      attributes.push({ Name: 'email', Value: user.email });
      attributes.push({ Name: 'email_verified', Value: 'true' });
    }

    await client.send(
      new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: loginId,
        MessageAction: 'SUPPRESS',
        TemporaryPassword: temporaryPassword,
        UserAttributes: attributes,
      }),
    );

    const created = await client.send(
      new AdminGetUserCommand({
        UserPoolId: userPoolId,
        Username: loginId,
      }),
    );
    const newSub = attrMap(created.UserAttributes).sub;
    if (!newSub) {
      throw new Error(`Could not resolve sub for imported user ${user.username}`);
    }
    subRemap.set(user.oldSub, newSub);

    if (user.isAdmin) {
      await client.send(
        new AdminAddUserToGroupCommand({
          UserPoolId: userPoolId,
          Username: loginId,
          GroupName: 'Admin',
        }),
      );
    }
  }

  return subRemap;
}

import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../data/resource';
import { env } from '$amplify/env/bootstrap-admin';
import { normalizeContactEmail, poolId, toLoginId } from '../shared/cognito';
import { ensureProfileForCognitoUser } from '../shared/profile-consolidation';

type Handler = Schema['bootstrapAdmin']['functionHandler'];

const cognito = new CognitoIdentityProviderClient({});
const ADMIN_GROUP = 'Admin';

const dataClientPromise = getAmplifyDataClientConfig(
  env as Parameters<typeof getAmplifyDataClientConfig>[0],
).then(({ resourceConfig, libraryOptions }) => {
  Amplify.configure(resourceConfig, libraryOptions);
  return generateClient<Schema>();
});

export const handler: Handler = async (event) => {
  const { username, password, contactEmail } = event.arguments;
  const handle = username.trim().toLowerCase();
  const loginId = toLoginId(handle);

  const existing = await cognito.send(
    new ListUsersCommand({ UserPoolId: poolId(), Limit: 1 }),
  );
  if ((existing.Users?.length ?? 0) > 0) {
    throw new Error('System already has users. Sign in instead.');
  }

  if (contactEmail?.trim()) {
    const normalized = normalizeContactEmail(contactEmail);
    if (!normalized) {
      throw new Error('Enter a valid email address');
    }
  }

  const attrs = [
    { Name: 'preferred_username', Value: handle },
    { Name: 'email', Value: loginId },
    { Name: 'email_verified', Value: 'true' },
  ];

  await cognito.send(
    new AdminCreateUserCommand({
      UserPoolId: poolId(),
      Username: loginId,
      TemporaryPassword: password,
      MessageAction: 'SUPPRESS',
      UserAttributes: attrs,
    }),
  );

  await cognito.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: poolId(),
      Username: loginId,
      GroupName: ADMIN_GROUP,
    }),
  );

  await cognito.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: poolId(),
      Username: loginId,
      Password: password,
      Permanent: true,
    }),
  );

  const created = await cognito.send(
    new ListUsersCommand({
      UserPoolId: poolId(),
      Filter: `preferred_username = "${handle}"`,
      Limit: 1,
    }),
  );
  const attrsMap = Object.fromEntries(
    (created.Users?.[0]?.Attributes ?? []).map((a) => [a.Name!, a.Value!]),
  );
  const sub = attrsMap.sub ?? null;
  const client = await dataClientPromise;
  await ensureProfileForCognitoUser(client, {
    username: handle,
    cognitoSub: sub,
    contactEmail: contactEmail?.trim()
      ? normalizeContactEmail(contactEmail)
      : null,
  });

  return { username: handle, message: 'Admin account created. Sign in below.' };
};

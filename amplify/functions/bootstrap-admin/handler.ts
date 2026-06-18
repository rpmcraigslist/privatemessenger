import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import type { Schema } from '../../data/resource';
import { poolId, toLoginId } from '../shared/cognito';

type Handler = Schema['bootstrapAdmin']['functionHandler'];

const cognito = new CognitoIdentityProviderClient({});
const ADMIN_GROUP = 'Admin';

export const handler: Handler = async (event) => {
  const { username, password, phoneNumber } = event.arguments;
  const handle = username.trim().toLowerCase();
  const loginId = toLoginId(handle);

  const existing = await cognito.send(
    new ListUsersCommand({ UserPoolId: poolId(), Limit: 1 }),
  );
  if ((existing.Users?.length ?? 0) > 0) {
    throw new Error('System already has users. Sign in instead.');
  }

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

  return { username: handle, message: 'Admin account created. Sign in below.' };
};

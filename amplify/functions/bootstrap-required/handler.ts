import { CognitoIdentityProviderClient, ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider';
import type { Schema } from '../../data/resource';
import { poolId } from '../shared/cognito';

type Handler = Schema['bootstrapRequired']['functionHandler'];

const cognito = new CognitoIdentityProviderClient({});

export const handler: Handler = async () => {
  const res = await cognito.send(
    new ListUsersCommand({ UserPoolId: poolId(), Limit: 1 }),
  );
  return (res.Users?.length ?? 0) === 0;
};

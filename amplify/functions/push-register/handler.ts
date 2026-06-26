import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../data/resource';
import { env } from '$amplify/env/push-register';
import { isCognitoUuid, parseIdentity, resolveUsernameFromPool } from '../shared/cognito';
import { consolidateUserProfiles } from '../shared/profile-consolidation';

type Handler = Schema['updateWebPushSubscription']['functionHandler'];
type DataClient = ReturnType<typeof generateClient<Schema>>;

const dataClientPromise = getAmplifyDataClientConfig(
  env as Parameters<typeof getAmplifyDataClientConfig>[0],
).then(({ resourceConfig, libraryOptions }) => {
  Amplify.configure(resourceConfig, libraryOptions);
  return generateClient<Schema>();
});

export const handler: Handler = async (event) => {
  let { username, sub } = parseIdentity(event.identity);
  if (!sub) {
    throw new Error('Unauthorized');
  }
  if (!username || isCognitoUuid(username)) {
    username = await resolveUsernameFromPool(sub);
  }
  if (!username) {
    throw new Error('Could not resolve username from Cognito profile');
  }

  const { enabled, endpoint, p256dh, auth } = event.arguments;
  const client = await dataClientPromise;
  const existing = await consolidateUserProfiles(client, username, sub);

  if (!existing?.id) {
    throw new Error('Profile not found');
  }

  if (!enabled) {
    const { errors } = await client.models.UserProfile.update(
      {
        id: existing.id,
        webPushEndpoint: null,
        webPushP256dh: null,
        webPushAuth: null,
      },
      { authMode: 'iam' },
    );
    if (errors?.length) {
      throw new Error(errors[0].message ?? 'Could not clear Web Push subscription');
    }
    return { registered: false };
  }

  const pushEndpoint = endpoint?.trim();
  const pushP256dh = p256dh?.trim();
  const pushAuth = auth?.trim();
  if (!pushEndpoint || !pushP256dh || !pushAuth) {
    throw new Error('Web Push subscription keys are required when enabled is true');
  }

  const { errors } = await client.models.UserProfile.update(
    {
      id: existing.id,
      webPushEndpoint: pushEndpoint,
      webPushP256dh: pushP256dh,
      webPushAuth: pushAuth,
    },
    { authMode: 'iam' },
  );
  if (errors?.length) {
    throw new Error(errors[0].message ?? 'Could not save Web Push subscription');
  }

  return { registered: true };
};

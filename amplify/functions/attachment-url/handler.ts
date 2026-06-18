import type { AppSyncResolverHandler } from 'aws-lambda';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../data/resource';
import { callerSub } from '../shared/cognito';
import { env } from '$amplify/env/attachment-url';

type Args = {
  conversationId: string;
  attachmentKey: string;
};

const s3 = new S3Client({});
const dataClientPromise = getAmplifyDataClientConfig(
  env as Parameters<typeof getAmplifyDataClientConfig>[0],
).then(({ resourceConfig, libraryOptions }) => {
  Amplify.configure(resourceConfig, libraryOptions);
  return generateClient<Schema>();
});

export const handler: AppSyncResolverHandler<Args, string> = async (event) => {
  const sub = callerSub(event.identity);
  if (!sub) {
    throw new Error('Unauthorized');
  }

  const { conversationId, attachmentKey } = event.arguments;
  const expectedPrefix = `conversations/${conversationId}/`;
  if (!attachmentKey.startsWith(expectedPrefix)) {
    throw new Error('Forbidden');
  }

  const client = await dataClientPromise;
  const conversation = await client.models.Conversation.get(
    { id: conversationId },
    { authMode: 'iam' },
  );

  const participants =
    conversation.data?.participants
      ?.filter((p): p is string => !!p)
      .map((p) => p.toLowerCase()) ?? [];

  if (!participants.includes(sub)) {
    throw new Error('Forbidden');
  }

  const bucket = process.env.STORAGE_BUCKET_NAME;
  if (!bucket) {
    throw new Error('Storage bucket is not configured');
  }

  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: bucket, Key: attachmentKey }),
    { expiresIn: 300 },
  );
};

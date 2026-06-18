import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../data/resource';
import { env } from '$amplify/env/message-alerts';

type Handler = Schema['sendMessageAlerts']['functionHandler'];

const sns = new SNSClient({});
const dataClientPromise = getAmplifyDataClientConfig(
  env as Parameters<typeof getAmplifyDataClientConfig>[0],
).then(({ resourceConfig, libraryOptions }) => {
  Amplify.configure(resourceConfig, libraryOptions);
  return generateClient<Schema>();
});

export const handler: Handler = async (event) => {
  const { messageId } = event.arguments;
  const client = await dataClientPromise;

  const message = await client.models.Message.get(
    { id: messageId },
    { authMode: 'iam' },
  );
  if (!message.data) return { sent: 0 };

  const { senderUsername, participantUsernames, content, conversationId } =
    message.data;
  const preview =
    content?.slice(0, 80) ||
    (message.data.type === 'image' ? 'New photo' : 'New attachment');
  let sent = 0;

  for (const participantSub of participantUsernames ?? []) {
    if (!participantSub || participantSub === senderUsername) continue;

    const profiles = await client.models.UserProfile.list({
      filter: { cognitoSub: { eq: participantSub } },
      authMode: 'iam',
    });
    const profile = profiles.data[0];
    if (!profile) continue;
    if (profile.username === senderUsername?.toLowerCase()) continue;
    const phone = profile.phoneNumber;
    if (!phone) continue;

    try {
      await sns.send(
        new PublishCommand({
          PhoneNumber: phone,
          Message: `Private Messenger: ${senderUsername}: ${preview}`,
        }),
      );
      sent++;
    } catch (err) {
      console.error('SMS failed for', participantSub, err);
    }
  }

  return { sent, conversationId };
};

import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../data/resource';
import { env } from '$amplify/env/message-alerts';
import { isCognitoUuid, resolveCallerIdentity } from '../shared/cognito';

type Handler = Schema['sendMessageAlerts']['functionHandler'];

const sns = new SNSClient({});
const dataClientPromise = getAmplifyDataClientConfig(
  env as Parameters<typeof getAmplifyDataClientConfig>[0],
).then(({ resourceConfig, libraryOptions }) => {
  Amplify.configure(resourceConfig, libraryOptions);
  return generateClient<Schema>();
});

function smsSenderLabel(
  identityUsername: string | null,
  messageSenderUsername: string | null | undefined,
): string {
  const candidate = identityUsername ?? messageSenderUsername ?? '';
  if (!candidate || isCognitoUuid(candidate)) return 'someone';
  return candidate;
}

function loginUrl(appUrl?: string | null): string {
  const fromArg = appUrl?.trim();
  if (fromArg) return fromArg.replace(/\/$/, '');
  const fromEnv = process.env.MESSENGER_APP_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  return 'https://example.com';
}

export const handler: Handler = async (event) => {
  const { messageId, appUrl } = event.arguments;
  const { sub: callerSub, username: callerUsername } =
    await resolveCallerIdentity(event.identity);
  if (!callerSub) {
    throw new Error('Unauthorized');
  }

  const client = await dataClientPromise;
  const message = await client.models.Message.get(
    { id: messageId },
    { authMode: 'iam' },
  );
  if (!message.data) return { sent: 0 };

  const { senderUsername, participantUsernames } = message.data;
  const senderName = smsSenderLabel(callerUsername, senderUsername);
  const url = loginUrl(appUrl);
  const smsBody = `New message received from ${senderName}, click ${url} to see message`;

  let sent = 0;

  for (const participantSub of participantUsernames ?? []) {
    if (!participantSub || participantSub === callerSub) continue;

    const profiles = await client.models.UserProfile.list({
      filter: { cognitoSub: { eq: participantSub } },
      authMode: 'iam',
    });
    const profile = profiles.data[0];
    const phone = profile?.phoneNumber?.trim();
    if (!profile?.smsNotificationsEnabled || !phone) continue;

    try {
      await sns.send(
        new PublishCommand({
          PhoneNumber: phone,
          Message: smsBody,
          MessageAttributes: {
            'AWS.SNS.SMS.SMSType': {
              DataType: 'String',
              StringValue: 'Transactional',
            },
          },
        }),
      );
      sent++;
    } catch (err) {
      console.error('SMS failed for', participantSub, phone, err);
    }
  }

  return { sent, conversationId: message.data.conversationId ?? undefined };
};

import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../data/resource';
import { env } from '$amplify/env/message-alerts';
import { isCognitoUuid, resolveCallerIdentity } from '../shared/cognito';
import {
  findProfileForParticipant,
  isParticipantSender,
  profileSmsTarget,
} from '../shared/profiles';

type Handler = Schema['sendMessageAlerts']['functionHandler'];
type DataClient = ReturnType<typeof generateClient<Schema>>;
type MessageModel = Schema['Message']['type'];

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

async function loadMessage(
  client: DataClient,
  messageId: string,
): Promise<MessageModel | null> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const message = await client.models.Message.get(
      { id: messageId },
      { authMode: 'iam' },
    );
    if (message.data) return message.data;
    await new Promise((resolve) => setTimeout(resolve, 75 * (attempt + 1)));
  }
  return null;
}

export const handler: Handler = async (event) => {
  const { messageId, appUrl } = event.arguments;
  const { sub: callerSub, username: callerUsername } =
    await resolveCallerIdentity(event.identity);
  if (!callerSub) {
    throw new Error('Unauthorized');
  }

  const client = await dataClientPromise;
  const message = await loadMessage(client, messageId);
  if (!message) {
    console.warn('sendMessageAlerts: message not found', messageId);
    return { sent: 0, failed: 0, skipped: 0 };
  }

  const { senderUsername, participantUsernames } = message;
  const senderName = smsSenderLabel(callerUsername, senderUsername);
  const url = loginUrl(appUrl);
  const smsBody = `New message received from ${senderName}, click ${url} to see message`;

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const participantId of participantUsernames ?? []) {
    if (!participantId) continue;
    if (isParticipantSender(participantId, callerSub, callerUsername)) {
      continue;
    }

    const profile = await findProfileForParticipant(client, participantId);
    const target = profileSmsTarget(profile);
    if (!target) {
      skipped++;
      console.info('sendMessageAlerts: skip recipient', {
        participantId,
        profileId: profile?.id,
        smsEnabled: profile?.smsNotificationsEnabled,
        hasPhone: Boolean(profile?.phoneNumber?.trim()),
      });
      continue;
    }

    try {
      await sns.send(
        new PublishCommand({
          PhoneNumber: target.phone,
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
      console.info('sendMessageAlerts: SMS sent', {
        participantId,
        phone: target.phone.replace(/\d(?=\d{4})/g, '*'),
      });
    } catch (err) {
      failed++;
      console.error('sendMessageAlerts: SMS failed', {
        participantId,
        phone: target.phone,
        err,
      });
    }
  }

  console.info('sendMessageAlerts: done', {
    messageId,
    sent,
    failed,
    skipped,
    participantCount: participantUsernames?.length ?? 0,
  });

  return { sent, failed, skipped, conversationId: message.conversationId ?? undefined };
};

import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../data/resource';
import { env } from '$amplify/env/message-alerts';
import { isCognitoUuid, resolveCallerIdentity } from '../shared/cognito';
import {
  buildMessageAlertEmail,
  buildMessengerDeepLink,
  resolveMessengerAppUrl,
} from '../shared/message-alert-content';
import {
  findProfileForParticipant,
  isParticipantSender,
  profileEmailTarget,
} from '../shared/profiles';
import {
  isMessengerFromEmailConfigured,
  messengerFromEmail,
  sendSesEmail,
} from '../shared/ses-email';

type Handler = Schema['sendMessageAlerts']['functionHandler'];
type DataClient = ReturnType<typeof generateClient<Schema>>;
type MessageModel = Schema['Message']['type'];

const dataClientPromise = getAmplifyDataClientConfig(
  env as Parameters<typeof getAmplifyDataClientConfig>[0],
).then(({ resourceConfig, libraryOptions }) => {
  Amplify.configure(resourceConfig, libraryOptions);
  return generateClient<Schema>();
});

function alertSenderLabel(
  identityUsername: string | null,
  messageSenderUsername: string | null | undefined,
): string {
  const candidate = identityUsername ?? messageSenderUsername ?? '';
  if (!candidate || isCognitoUuid(candidate)) return 'someone';
  return candidate;
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

async function sendEmailAlert(
  toAddress: string,
  openUrl: string,
  senderName: string,
): Promise<void> {
  const { subject, textBody, htmlBody } = buildMessageAlertEmail({
    openUrl,
    senderName,
  });

  await sendSesEmail({ toAddress, subject, textBody, htmlBody });
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
  if (!message?.conversationId) {
    console.warn('sendMessageAlerts: message not found', messageId);
    return {
      sent: 0,
      failed: 0,
      skipped: 0,
      fromEmailConfigured: isMessengerFromEmailConfigured(),
    };
  }

  const { senderUsername, participantUsernames, conversationId } = message;
  const senderName = alertSenderLabel(callerUsername, senderUsername);
  const baseUrl = resolveMessengerAppUrl(appUrl);
  const openUrl = buildMessengerDeepLink(baseUrl, conversationId, messageId);

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const fromEmail = messengerFromEmail();

  for (const participantId of participantUsernames ?? []) {
    if (!participantId) continue;
    if (isParticipantSender(participantId, callerSub, callerUsername)) {
      continue;
    }

    const profile = await findProfileForParticipant(client, participantId);
    const emailTarget = profileEmailTarget(profile);

    if (emailTarget && fromEmail) {
      try {
        await sendEmailAlert(emailTarget.email, openUrl, senderName);
        sent++;
        console.info('sendMessageAlerts: email sent', {
          participantId,
          email: emailTarget.email.replace(/(^.).*(@.*$)/, '$1***$2'),
        });
      } catch (err) {
        failed++;
        console.error('sendMessageAlerts: email failed', {
          participantId,
          email: emailTarget.email,
          err,
        });
      }
    } else if (emailTarget && !fromEmail) {
      skipped++;
      console.info('sendMessageAlerts: email skipped (no MESSENGER_FROM_EMAIL)', {
        participantId,
      });
    } else {
      skipped++;
      console.info('sendMessageAlerts: skip recipient', {
        participantId,
        profileId: profile?.id,
        hasContactEmail: Boolean(profile?.contactEmail?.trim()),
      });
    }
  }

  console.info('sendMessageAlerts: done', {
    messageId,
    sent,
    failed,
    skipped,
    participantCount: participantUsernames?.length ?? 0,
    fromEmailConfigured: Boolean(fromEmail),
  });

  return {
    sent,
    failed,
    skipped,
    conversationId,
    fromEmailConfigured: Boolean(fromEmail),
  };
};

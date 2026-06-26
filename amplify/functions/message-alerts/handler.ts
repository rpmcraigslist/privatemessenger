import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { SendEmailCommand, SESClient } from '@aws-sdk/client-ses';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../data/resource';
import { env } from '$amplify/env/message-alerts';
import { isCognitoUuid, resolveCallerIdentity } from '../shared/cognito';
import {
  buildMessageAlertEmail,
  buildMessengerDeepLink,
  formatSesFromAddress,
  resolveMessengerAppUrl,
} from '../shared/message-alert-content';
import {
  findProfileForParticipant,
  isParticipantSender,
  profileEmailTarget,
  profileSmsTarget,
} from '../shared/profiles';
import {
  clearWebPushOnProfile,
  isExpiredWebPushError,
  isWebPushConfigured,
  messagePushPreview,
  profileWebPushTarget,
  sendWebPushAlert,
} from '../shared/web-push';

type Handler = Schema['sendMessageAlerts']['functionHandler'];
type DataClient = ReturnType<typeof generateClient<Schema>>;
type MessageModel = Schema['Message']['type'];

const sns = new SNSClient({});
const ses = new SESClient({});
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

function fromEmailAddress(): string | null {
  const value = process.env.MESSENGER_FROM_EMAIL?.trim();
  return value || null;
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
  const from = fromEmailAddress();
  if (!from) {
    throw new Error('MESSENGER_FROM_EMAIL is not configured');
  }

  const { subject, textBody, htmlBody } = buildMessageAlertEmail({
    openUrl,
    senderName,
  });

  await ses.send(
    new SendEmailCommand({
      Source: formatSesFromAddress(from),
      Destination: { ToAddresses: [toAddress] },
      Message: {
        Subject: { Data: subject, Charset: 'UTF-8' },
        Body: {
          Text: { Data: textBody, Charset: 'UTF-8' },
          Html: { Data: htmlBody, Charset: 'UTF-8' },
        },
      },
    }),
  );
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
    return { sent: 0, failed: 0, skipped: 0 };
  }

  const { senderUsername, participantUsernames, conversationId } = message;
  const senderName = smsSenderLabel(callerUsername, senderUsername);
  const baseUrl = resolveMessengerAppUrl(appUrl);
  const openUrl = buildMessengerDeepLink(baseUrl, conversationId, messageId);
  const smsBody = `You've got a new message from ${senderName}. Open: ${openUrl}`;
  const pushTitle = `New message from ${senderName}`;
  const pushBody = messagePushPreview(message);
  const webPushEnabled = isWebPushConfigured();

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const fromEmail = fromEmailAddress();

  for (const participantId of participantUsernames ?? []) {
    if (!participantId) continue;
    if (isParticipantSender(participantId, callerSub, callerUsername)) {
      continue;
    }

    const profile = await findProfileForParticipant(client, participantId);
    const emailTarget = profileEmailTarget(profile);
    const smsTarget = profileSmsTarget(profile);
    const pushTarget = webPushEnabled ? profileWebPushTarget(profile) : null;
    let delivered = false;

    if (emailTarget && fromEmail) {
      try {
        await sendEmailAlert(emailTarget.email, openUrl, senderName);
        sent++;
        delivered = true;
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
    }

    if (smsTarget) {
      try {
        await sns.send(
          new PublishCommand({
            PhoneNumber: smsTarget.phone,
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
        delivered = true;
        console.info('sendMessageAlerts: SMS sent', {
          participantId,
          phone: smsTarget.phone.replace(/\d(?=\d{4})/g, '*'),
        });
      } catch (err) {
        failed++;
        console.error('sendMessageAlerts: SMS failed', {
          participantId,
          phone: smsTarget.phone,
          err,
        });
      }
    }

    if (pushTarget) {
      try {
        await sendWebPushAlert(pushTarget, {
          title: pushTitle,
          body: pushBody,
          conversationId,
          messageId: message.id!,
        });
        sent++;
        delivered = true;
        console.info('sendMessageAlerts: Web Push sent', { participantId });
      } catch (err) {
        failed++;
        console.error('sendMessageAlerts: Web Push failed', { participantId, err });
        if (profile && isExpiredWebPushError(err)) {
          try {
            await clearWebPushOnProfile(client, profile);
          } catch (clearErr) {
            console.error('sendMessageAlerts: could not clear expired Web Push', {
              participantId,
              clearErr,
            });
          }
        }
      }
    }

    if (!delivered && !emailTarget && !smsTarget && !pushTarget) {
      skipped++;
      console.info('sendMessageAlerts: skip recipient', {
        participantId,
        profileId: profile?.id,
        hasContactEmail: Boolean(profile?.contactEmail?.trim()),
        smsEnabled: profile?.smsNotificationsEnabled,
        hasPhone: Boolean(profile?.phoneNumber?.trim()),
        hasWebPush: Boolean(pushTarget),
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
    webPushConfigured: webPushEnabled,
  });

  return { sent, failed, skipped, conversationId };
};

import { SendEmailCommand, SESClient } from '@aws-sdk/client-ses';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../data/resource';
import { env } from '$amplify/env/account-request';
import { listAdminNotificationEmails } from '../shared/admin-notify';
import { normalizeContactEmail } from '../shared/contact-email';
import {
  normalizeUsername,
  usernameValidationError,
} from '../shared/username';
import {
  buildAccountRequestAdminEmail,
  formatSesFromAddress,
  resolveMessengerAppUrl,
} from '../shared/message-alert-content';

type Handler = Schema['requestAccountAccess']['functionHandler'];

const ses = new SESClient({});
const dataClientPromise = getAmplifyDataClientConfig(
  env as Parameters<typeof getAmplifyDataClientConfig>[0],
).then(({ resourceConfig, libraryOptions }) => {
  Amplify.configure(resourceConfig, libraryOptions);
  return generateClient<Schema>();
});

function fromEmailAddress(): string | null {
  const value = process.env.MESSENGER_FROM_EMAIL?.trim();
  return value || null;
}

export const handler: Handler = async (event) => {
  const requestedUsername = normalizeUsername(event.arguments.username ?? '');
  const usernameErr = usernameValidationError(requestedUsername);
  if (usernameErr) {
    throw new Error(usernameErr);
  }

  const requesterEmail = normalizeContactEmail(event.arguments.contactEmail ?? '');
  if (!requesterEmail) {
    throw new Error('Enter a valid email address');
  }

  const fromEmail = fromEmailAddress();
  if (!fromEmail) {
    console.error('requestAccountAccess: MESSENGER_FROM_EMAIL is not configured');
    return {
      message:
        'Account requests are not configured yet. Please contact your administrator directly.',
      notified: false,
    };
  }

  const client = await dataClientPromise;
  const adminEmails = await listAdminNotificationEmails(client);
  if (adminEmails.length === 0) {
    console.warn('requestAccountAccess: no admin contact email on file', {
      requestedUsername,
      requesterEmail,
    });
    return {
      message:
        'Thanks — we received your request. An administrator will follow up by email when available.',
      notified: false,
    };
  }

  const appUrl = resolveMessengerAppUrl(event.arguments.appUrl);
  const requestedAtIso = new Date().toISOString();
  const { subject, textBody, htmlBody } = buildAccountRequestAdminEmail({
    requesterUsername: requestedUsername,
    requesterEmail,
    appUrl,
    requestedAtIso,
  });

  let notified = false;
  for (const toAddress of adminEmails) {
    try {
      await ses.send(
        new SendEmailCommand({
          Source: formatSesFromAddress(fromEmail),
          Destination: { ToAddresses: [toAddress] },
          ReplyToAddresses: [requesterEmail],
          Message: {
            Subject: { Data: subject, Charset: 'UTF-8' },
            Body: {
              Text: { Data: textBody, Charset: 'UTF-8' },
              Html: { Data: htmlBody, Charset: 'UTF-8' },
            },
          },
        }),
      );
      notified = true;
      console.info('requestAccountAccess: admin notified', {
        adminEmail: toAddress.replace(/(^.).*(@.*$)/, '$1***$2'),
        requesterUsername: requestedUsername,
        requesterEmail: requesterEmail.replace(/(^.).*(@.*$)/, '$1***$2'),
      });
    } catch (err) {
      console.error('requestAccountAccess: admin notify failed', {
        adminEmail: toAddress,
        err,
      });
    }
  }

  return {
    message: notified
      ? 'Thanks — your request was sent to the administrator. They will email you after reviewing it.'
      : 'Thanks — we received your request. An administrator will follow up by email when available.',
    notified,
  };
};

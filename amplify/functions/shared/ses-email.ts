import { SendEmailCommand } from '@aws-sdk/client-ses';
import { formatSesFromAddress } from './message-alert-content';
import { createSesClient } from './ses-client';

let sesClient: ReturnType<typeof createSesClient> | null = null;

function getSesClient(): ReturnType<typeof createSesClient> {
  if (!sesClient) sesClient = createSesClient();
  return sesClient;
}

/** Verified sender address baked into Lambda env at deploy time (Amplify env var). */
export function messengerFromEmail(): string | null {
  const value = process.env.MESSENGER_FROM_EMAIL?.trim();
  return value || null;
}

export function isMessengerFromEmailConfigured(): boolean {
  return Boolean(messengerFromEmail());
}

export async function sendSesEmail(input: {
  toAddress: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
}): Promise<void> {
  const from = messengerFromEmail();
  if (!from) {
    throw new Error('MESSENGER_FROM_EMAIL is not configured');
  }

  const body: {
    Subject: { Data: string; Charset: string };
    Body: {
      Text: { Data: string; Charset: string };
      Html?: { Data: string; Charset: string };
    };
  } = {
    Subject: { Data: input.subject, Charset: 'UTF-8' },
    Body: {
      Text: { Data: input.textBody, Charset: 'UTF-8' },
    },
  };

  if (input.htmlBody) {
    body.Body.Html = { Data: input.htmlBody, Charset: 'UTF-8' };
  }

  await getSesClient().send(
    new SendEmailCommand({
      Source: formatSesFromAddress(from),
      Destination: { ToAddresses: [input.toAddress] },
      Message: body,
    }),
  );
}

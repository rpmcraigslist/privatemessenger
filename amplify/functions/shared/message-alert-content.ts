export const DEFAULT_EMAIL_FROM_DISPLAY_NAME = 'Private Messenger Service';

export function resolveEmailFromDisplayName(): string {
  const fromEnv = process.env.MESSENGER_FROM_DISPLAY_NAME?.trim();
  return fromEnv || DEFAULT_EMAIL_FROM_DISPLAY_NAME;
}

export function resolveMessengerAppUrl(appUrl?: string | null): string {
  const fromArg = appUrl?.trim();
  if (fromArg) return fromArg.replace(/\/$/, '');
  const fromEnv = process.env.MESSENGER_APP_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  return 'https://example.com';
}

export function buildMessengerDeepLink(
  appUrl: string,
  conversationId: string,
  messageId: string,
): string {
  const params = new URLSearchParams({
    chat: conversationId,
    message: messageId,
  });
  return `${appUrl}/?${params.toString()}`;
}

/** SES Source with friendly from-name (verified address must be the email part). */
export function formatSesFromAddress(fromEmail: string): string {
  const email = fromEmail.trim();
  if (!email) return email;
  if (email.includes('<') && email.includes('>')) return email;
  return `"${resolveEmailFromDisplayName()}" <${email}>`;
}

export function buildMessageAlertEmail(input: {
  openUrl: string;
  senderName?: string | null;
}): { subject: string; textBody: string; htmlBody: string } {
  const subject = "You've got a new message";
  const fromLine = input.senderName
    ? `You have a new message from ${input.senderName} in Private Messenger.`
    : 'You have a new message in Private Messenger.';

  const textBody = [
    fromLine,
    '',
    'View the message in your browser:',
    input.openUrl,
    '',
    'Sign in if prompted — you will be taken directly to that message.',
    '',
    '---',
    'Do not reply to this email. This mailbox is not monitored.',
    `Sent by ${resolveEmailFromDisplayName()}.`,
  ].join('\n');

  const htmlBody = [
    `<p>${fromLine}</p>`,
    `<p><a href="${input.openUrl}">View message in Private Messenger</a></p>`,
    '<p>Sign in if prompted — you will be taken directly to that message.</p>',
    '<hr>',
    '<p style="color:#666;font-size:12px;">',
    '<strong>Do not reply</strong> to this email. This mailbox is not monitored.<br>',
    `Sent by ${resolveEmailFromDisplayName()}.`,
    '</p>',
  ].join('');

  return { subject, textBody, htmlBody };
}

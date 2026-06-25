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

export function buildAccountRequestAdminEmail(input: {
  requesterEmail: string;
  appUrl: string;
  requestedAtIso: string;
}): { subject: string; textBody: string; htmlBody: string } {
  const subject = 'Private Messenger — new account request';
  const textBody = [
    'Someone used the login page to request a new Private Messenger account.',
    '',
    `Claimed email address: ${input.requesterEmail}`,
    `Requested at (UTC): ${input.requestedAtIso}`,
    '',
    'Next steps for you:',
    '1. Sign in to Private Messenger as admin.',
    '2. Open Admin and create a user for them.',
    '3. Verify their email in Amazon SES (Ohio) if your account is still in sandbox.',
    '4. Reply to them directly with their username and temporary password.',
    '',
    `App: ${input.appUrl}`,
    '',
    '---',
    'Automated notice from Private Messenger.',
  ].join('\n');

  const htmlBody = [
    '<p>Someone used the login page to request a new Private Messenger account.</p>',
    '<ul>',
    `<li><strong>Claimed email:</strong> ${input.requesterEmail}</li>`,
    `<li><strong>Requested at (UTC):</strong> ${input.requestedAtIso}</li>`,
    '</ul>',
    '<p><strong>Next steps:</strong></p>',
    '<ol>',
    '<li>Sign in to Private Messenger as admin.</li>',
    '<li>Open Admin and create a user for them.</li>',
    '<li>Verify their email in Amazon SES (Ohio) if your account is still in sandbox.</li>',
    '<li>Reply to them directly with their username and temporary password.</li>',
    '</ol>',
    `<p><a href="${input.appUrl}">${input.appUrl}</a></p>`,
    '<hr>',
    '<p style="color:#666;font-size:12px;">Automated notice from Private Messenger.</p>',
  ].join('');

  return { subject, textBody, htmlBody };
}

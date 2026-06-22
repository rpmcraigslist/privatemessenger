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

export function buildMessageAlertEmail(input: {
  openUrl: string;
}): { subject: string; textBody: string; htmlBody: string } {
  const subject = "You've got a new message";
  const textBody = [
    "You've got a new message.",
    '',
    `Open your conversation: ${input.openUrl}`,
    '',
    'Sign in if prompted — you will be taken to the message afterward.',
  ].join('\n');

  const htmlBody = [
    '<p>You\'ve got a new message.</p>',
    `<p><a href="${input.openUrl}">Open conversation</a></p>`,
    '<p>Sign in if prompted — you will be taken to the message afterward.</p>',
  ].join('');

  return { subject, textBody, htmlBody };
}

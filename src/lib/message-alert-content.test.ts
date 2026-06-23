import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EMAIL_FROM_DISPLAY_NAME,
  buildMessageAlertEmail,
  buildMessengerDeepLink,
  formatSesFromAddress,
} from '../../amplify/functions/shared/message-alert-content';

describe('message-alert-content', () => {
  it('builds deep link for email alerts', () => {
    expect(
      buildMessengerDeepLink(
        'https://main.d332i3bk71so1w.amplifyapp.com',
        'conv-a',
        'msg-b',
      ),
    ).toContain('chat=conv-a');
    expect(
      buildMessengerDeepLink(
        'https://main.d332i3bk71so1w.amplifyapp.com',
        'conv-a',
        'msg-b',
      ),
    ).toContain('message=msg-b');
  });

  it('formats SES from address with service display name', () => {
    expect(formatSesFromAddress('alerts@example.com')).toBe(
      `"${DEFAULT_EMAIL_FROM_DISPLAY_NAME}" <alerts@example.com>`,
    );
  });

  it('uses service branding, do-not-reply, and deep link', () => {
    const link =
      'https://main.d332i3bk71so1w.amplifyapp.com/?chat=c1&message=m1';
    const email = buildMessageAlertEmail({ openUrl: link, senderName: 'lena' });

    expect(email.subject).toBe("You've got a new message");
    expect(email.textBody).toContain('new message from lena');
    expect(email.textBody).toContain(link);
    expect(email.textBody).toContain('Do not reply');
    expect(email.textBody).toContain(DEFAULT_EMAIL_FROM_DISPLAY_NAME);
    expect(email.htmlBody).toContain(`href="${link}"`);
    expect(email.htmlBody).toContain('Do not reply');
  });
});

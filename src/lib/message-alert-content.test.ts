import { describe, expect, it } from 'vitest';
import {
  buildMessageAlertEmail,
  buildMessengerDeepLink,
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

  it('uses the requested email copy and link', () => {
    const link =
      'https://main.d332i3bk71so1w.amplifyapp.com/?chat=c1&message=m1';
    const email = buildMessageAlertEmail({ openUrl: link });

    expect(email.subject).toBe("You've got a new message");
    expect(email.textBody).toContain("You've got a new message.");
    expect(email.textBody).toContain(link);
    expect(email.htmlBody).toContain(`href="${link}"`);
  });
});

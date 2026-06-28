import { describe, expect, it } from 'vitest';
import {
  buildAdminDirectEmailBodies,
  resolveContactEmailForUsername,
  validateAdminDirectEmailInput,
} from '../../amplify/functions/shared/admin-email-logic';

describe('admin-email-logic', () => {
  it('requires subject and body', () => {
    expect(validateAdminDirectEmailInput({ subject: '', bodyText: 'hi' })).toEqual({
      ok: false,
      error: 'Subject is required',
    });
    expect(validateAdminDirectEmailInput({ subject: 'Hello', bodyText: '   ' })).toEqual({
      ok: false,
      error: 'Message body is required',
    });
  });

  it('trims validated subject and body', () => {
    expect(
      validateAdminDirectEmailInput({
        subject: '  Test subject  ',
        bodyText: '  Hello there  ',
      }),
    ).toEqual({
      ok: true,
      subject: 'Test subject',
      bodyText: 'Hello there',
    });
  });

  it('resolves contact email by username handle', () => {
    const map = new Map([
      ['paul', 'paul@example.com'],
      ['lena', 'lena@example.com'],
    ]);
    expect(resolveContactEmailForUsername('Paul', map)).toBe('paul@example.com');
    expect(resolveContactEmailForUsername('missing', map)).toBeNull();
  });

  it('builds admin email bodies with footer', () => {
    const { textBody, htmlBody } = buildAdminDirectEmailBodies({
      bodyText: 'Line one\nLine two',
      adminUsername: 'paul',
    });

    expect(textBody).toContain('Line one');
    expect(textBody).toContain('Sent by paul via Private Messenger admin.');
    expect(textBody).toContain('Do not reply');
    expect(htmlBody).toContain('Line one<br>Line two');
    expect(htmlBody).toContain('Sent by paul via Private Messenger admin.');
  });
});

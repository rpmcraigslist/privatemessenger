const MAX_SUBJECT_LENGTH = 200;
const MAX_BODY_LENGTH = 10_000;

export type AdminDirectEmailInput = {
  subject: string;
  bodyText: string;
};

export type AdminDirectEmailValidation =
  | { ok: true; subject: string; bodyText: string }
  | { ok: false; error: string };

export function validateAdminDirectEmailInput(
  input: AdminDirectEmailInput,
): AdminDirectEmailValidation {
  const subject = input.subject.trim();
  const bodyText = input.bodyText.trim();

  if (!subject) {
    return { ok: false, error: 'Subject is required' };
  }
  if (!bodyText) {
    return { ok: false, error: 'Message body is required' };
  }
  if (subject.length > MAX_SUBJECT_LENGTH) {
    return {
      ok: false,
      error: `Subject is too long (max ${MAX_SUBJECT_LENGTH} characters)`,
    };
  }
  if (bodyText.length > MAX_BODY_LENGTH) {
    return {
      ok: false,
      error: `Message is too long (max ${MAX_BODY_LENGTH} characters)`,
    };
  }

  return { ok: true, subject, bodyText };
}

export function resolveContactEmailForUsername(
  username: string,
  emailByHandle: ReadonlyMap<string, string>,
): string | null {
  const handle = username.trim().toLowerCase();
  if (!handle) return null;
  return emailByHandle.get(handle) ?? null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildAdminDirectEmailBodies(input: {
  bodyText: string;
  adminUsername: string;
}): { textBody: string; htmlBody: string } {
  const footer = [
    '',
    '---',
    `Sent by ${input.adminUsername} via Private Messenger admin.`,
    'Do not reply to this email.',
  ].join('\n');

  const textBody = `${input.bodyText}${footer}`;
  const htmlBody = [
    `<p>${escapeHtml(input.bodyText).replace(/\n/g, '<br>')}</p>`,
    '<hr>',
    '<p style="color:#666;font-size:12px;">',
    `Sent by ${escapeHtml(input.adminUsername)} via Private Messenger admin.<br>`,
    'Do not reply to this email.',
    '</p>',
  ].join('');

  return { textBody, htmlBody };
}

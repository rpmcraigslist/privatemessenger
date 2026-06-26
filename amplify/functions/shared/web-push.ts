import webpush from 'web-push';
import type { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../data/resource';

type DataClient = ReturnType<typeof generateClient<Schema>>;
type UserProfile = Schema['UserProfile']['type'];
type MessageModel = Schema['Message']['type'];

export type WebPushTarget = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

let vapidConfigured = false;

export function isWebPushConfigured(): boolean {
  const publicKey = process.env.MESSENGER_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.MESSENGER_VAPID_PRIVATE_KEY?.trim();
  return Boolean(publicKey && privateKey);
}

function ensureVapidConfigured(): void {
  if (vapidConfigured) return;

  const publicKey = process.env.MESSENGER_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.MESSENGER_VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) {
    throw new Error('MESSENGER_VAPID_PUBLIC_KEY and MESSENGER_VAPID_PRIVATE_KEY are not configured');
  }

  const subject =
    process.env.MESSENGER_VAPID_SUBJECT?.trim() || 'mailto:messenger@example.com';
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
}

export function profileWebPushTarget(
  profile: UserProfile | null | undefined,
): WebPushTarget | null {
  if (!profile) return null;
  const endpoint = profile.webPushEndpoint?.trim();
  const p256dh = profile.webPushP256dh?.trim();
  const auth = profile.webPushAuth?.trim();
  if (!endpoint || !p256dh || !auth) return null;
  return { endpoint, p256dh, auth };
}

export function messagePushPreview(message: MessageModel): string {
  if (message.type === 'image') return 'Photo';
  if (message.type === 'file') {
    const name = message.attachmentName?.trim();
    return name ? `Attachment: ${name}` : 'Attachment';
  }
  const text = message.content?.trim();
  if (!text) return 'New message';
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

export function isExpiredWebPushError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const statusCode = (err as { statusCode?: number }).statusCode;
  return statusCode === 404 || statusCode === 410;
}

export async function clearWebPushOnProfile(
  client: DataClient,
  profile: UserProfile,
): Promise<void> {
  if (!profile.id) return;
  await client.models.UserProfile.update(
    {
      id: profile.id,
      webPushEndpoint: null,
      webPushP256dh: null,
      webPushAuth: null,
    },
    { authMode: 'iam' },
  );
}

export async function sendWebPushAlert(
  target: WebPushTarget,
  payload: {
    title: string;
    body: string;
    conversationId: string;
    messageId: string;
  },
): Promise<void> {
  ensureVapidConfigured();
  await webpush.sendNotification(
    {
      endpoint: target.endpoint,
      keys: {
        p256dh: target.p256dh,
        auth: target.auth,
      },
    },
    JSON.stringify(payload),
  );
}

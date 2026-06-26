import { useEffect } from 'react';
import { client } from './amplify';

const PUSH_REGISTERED_KEY = 'messenger:web-push-registered';
const VAPID_PUBLIC_KEY = import.meta.env.VITE_MESSENGER_VAPID_PUBLIC_KEY as string | undefined;

export function isWebPushConfigured(): boolean {
  return Boolean(VAPID_PUBLIC_KEY?.trim());
}

export function isWebPushRegisteredLocally(): boolean {
  try {
    return localStorage.getItem(PUSH_REGISTERED_KEY) === '1';
  } catch {
    return false;
  }
}

function setWebPushRegisteredLocally(registered: boolean): void {
  try {
    if (registered) {
      localStorage.setItem(PUSH_REGISTERED_KEY, '1');
    } else {
      localStorage.removeItem(PUSH_REGISTERED_KEY);
    }
  } catch {
    // ignore
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    output[index] = raw.charCodeAt(index);
  }
  return output;
}

async function persistWebPushSubscription(enabled: boolean): Promise<void> {
  const { errors } = await client.mutations.updateWebPushSubscription(
    enabled
      ? { enabled: true }
      : { enabled: false },
  );
  if (errors?.length) {
    throw new Error(errors[0]?.message ?? 'Could not save Web Push subscription');
  }
}

/** Register or clear the browser push subscription used for background alerts. */
export async function syncWebPushSubscription(enabled: boolean): Promise<void> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    setWebPushRegisteredLocally(false);
    return;
  }

  const registration = await navigator.serviceWorker.ready;

  if (!enabled || !isWebPushConfigured()) {
    const existing = await registration.pushManager.getSubscription();
    if (existing) {
      await existing.unsubscribe();
    }
    await persistWebPushSubscription(false);
    setWebPushRegisteredLocally(false);
    return;
  }

  if (Notification.permission !== 'granted') {
    setWebPushRegisteredLocally(false);
    return;
  }

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY!.trim()) as BufferSource,
    });
  }

  const json = subscription.toJSON();
  const endpoint = json.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    throw new Error('Could not read Web Push subscription keys');
  }

  await client.mutations.updateWebPushSubscription({
    enabled: true,
    endpoint,
    p256dh,
    auth,
  });
  setWebPushRegisteredLocally(true);
}

/** Re-register Web Push after sign-in when pop-up alerts are enabled. */
export function useWebPushSubscription(browserNotificationsEnabled: boolean): void {
  useEffect(() => {
    if (!browserNotificationsEnabled) return;
    void syncWebPushSubscription(true).catch((err) => {
      console.warn('web push registration failed', err);
    });
  }, [browserNotificationsEnabled]);
}

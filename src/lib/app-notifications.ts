import { useEffect } from 'react';

const PREFS_KEY = 'messenger:alert-prefs';
const PROMPT_DISMISSED_KEY = 'messenger:notify-prompt-dismissed';
const APP_TITLE = 'Private Messenger';

export type AlertPrefs = {
  browserNotifications: boolean;
  soundEnabled: boolean;
};

const DEFAULT_PREFS: AlertPrefs = {
  browserNotifications: false,
  soundEnabled: true,
};

let audioContext: AudioContext | null = null;
let notificationClickHandler: ((conversationId: string) => void) | null = null;

export function getAlertPrefs(): AlertPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<AlertPrefs>;
    return {
      browserNotifications: parsed.browserNotifications === true,
      soundEnabled: parsed.soundEnabled !== false,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function setAlertPrefs(update: Partial<AlertPrefs>): AlertPrefs {
  const next = { ...getAlertPrefs(), ...update };
  localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  return next;
}

export function isNotifyPromptDismissed(): boolean {
  return localStorage.getItem(PROMPT_DISMISSED_KEY) === '1';
}

export function dismissNotifyPrompt(): void {
  localStorage.setItem(PROMPT_DISMISSED_KEY, '1');
}

export function isBadgeSupported(): boolean {
  return typeof navigator !== 'undefined' && 'setAppBadge' in navigator;
}

export function isNotificationSupported(): boolean {
  return typeof Notification !== 'undefined';
}

export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (!isNotificationSupported()) return 'unsupported';
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!isNotificationSupported()) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  return Notification.requestPermission();
}

export function setNotificationClickHandler(
  handler: ((conversationId: string) => void) | null,
): void {
  notificationClickHandler = handler;
}

export function unlockNotificationSound(): void {
  if (typeof window === 'undefined') return;
  if (!audioContext) {
    const AudioCtx =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    audioContext = new AudioCtx();
  }
  if (audioContext.state === 'suspended') {
    void audioContext.resume();
  }
}

async function setBadgeViaServiceWorker(count: number): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    const controller = registration.active ?? navigator.serviceWorker.controller;
    if (!controller) return false;
    controller.postMessage({ type: 'set-badge', count });
    return true;
  } catch {
    return false;
  }
}

export async function syncUnreadIndicators(totalUnread: number): Promise<void> {
  if (typeof document !== 'undefined') {
    document.title =
      totalUnread > 0 ? `(${formatBadgeCount(totalUnread)}) ${APP_TITLE}` : APP_TITLE;
  }

  let badgeApplied = false;

  if (isBadgeSupported()) {
    try {
      if (totalUnread > 0) {
        await navigator.setAppBadge!(totalUnread);
      } else {
        await navigator.clearAppBadge!();
      }
      badgeApplied = true;
    } catch (err) {
      console.warn('app badge update failed', err);
    }
  }

  if (!badgeApplied) {
    await setBadgeViaServiceWorker(totalUnread);
  }
}

export async function clearUnreadIndicators(): Promise<void> {
  if (typeof document !== 'undefined') {
    document.title = APP_TITLE;
  }

  if (isBadgeSupported()) {
    try {
      await navigator.clearAppBadge!();
    } catch {
      // ignore
    }
  }

  await setBadgeViaServiceWorker(0);
}

function playMessageSoundWithWebAudio(): void {
  if (!audioContext) return;

  const ctx = audioContext;
  const now = ctx.currentTime;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
  gain.connect(ctx.destination);

  const tone = (frequency: number, start: number, duration: number) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency, start);
    osc.connect(gain);
    osc.start(start);
    osc.stop(start + duration);
  };

  tone(880, now, 0.12);
  tone(1174.66, now + 0.1, 0.18);
}

export function playMessageSound(): void {
  const prefs = getAlertPrefs();
  if (!prefs.soundEnabled) return;

  unlockNotificationSound();

  const audio = new Audio(createMessageChimeDataUri());
  audio.preload = 'auto';
  void audio.play().catch(() => {
    playMessageSoundWithWebAudio();
  });
}

export function showMessageNotification(options: {
  messageId: string;
  conversationId: string;
  title: string;
  body: string;
}): void {
  const prefs = getAlertPrefs();
  if (!prefs.browserNotifications) return;
  if (!isNotificationSupported() || Notification.permission !== 'granted') return;

  void displayMessageNotification(options);
}

function attachNotificationClickHandler(
  notification: Notification,
  conversationId: string,
): void {
  notification.onclick = () => {
    window.focus();
    notificationClickHandler?.(conversationId);
    notification.close();
  };
}

async function displayMessageNotification(options: {
  messageId: string;
  conversationId: string;
  title: string;
  body: string;
}): Promise<void> {
  const payload: NotificationOptions = {
    body: options.body,
    tag: `message-${options.messageId}`,
    renotify: true,
    icon: '/icon.svg',
    badge: '/icon.svg',
    data: { conversationId: options.conversationId },
  };

  const pageVisible =
    typeof document !== 'undefined' && document.visibilityState === 'visible';

  // Foreground: page Notification API is more reliable than service worker.
  if (pageVisible) {
    try {
      const notification = new Notification(options.title, payload);
      attachNotificationClickHandler(notification, options.conversationId);
      return;
    } catch (err) {
      console.warn('page notification failed', err);
    }
  }

  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification(options.title, payload);
      return;
    } catch (err) {
      console.warn('service worker notification failed', err);
    }
  }

  try {
    const notification = new Notification(options.title, payload);
    attachNotificationClickHandler(notification, options.conversationId);
  } catch (err) {
    console.warn('notification fallback failed', err);
  }
}

/** Re-apply icon badge when the app returns to the foreground. */
export function useAppBadgeResync(totalUnread: number): void {
  useEffect(() => {
    const resync = () => {
      if (document.visibilityState === 'visible') {
        void syncUnreadIndicators(totalUnread);
      }
    };

    document.addEventListener('visibilitychange', resync);
    window.addEventListener('focus', resync);
    return () => {
      document.removeEventListener('visibilitychange', resync);
      window.removeEventListener('focus', resync);
    };
  }, [totalUnread]);
}

function formatBadgeCount(count: number): string {
  return count > 99 ? '99+' : String(count);
}

/** Short WAV chime — works on mobile browsers where Web Audio is blocked. */
function createMessageChimeDataUri(): string {
  const sampleRate = 22050;
  const durationSeconds = 0.35;
  const sampleCount = Math.floor(sampleRate * durationSeconds);
  const bytesPerSample = 2;
  const dataSize = sampleCount * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  for (let index = 0; index < sampleCount; index += 1) {
    const time = index / sampleRate;
    const first = Math.sin(2 * Math.PI * 880 * time) * Math.exp(-time * 8);
    const second =
      time > 0.1
        ? Math.sin(2 * Math.PI * 1174.66 * (time - 0.1)) * Math.exp(-(time - 0.1) * 6)
        : 0;
    const sample = Math.max(-1, Math.min(1, first * 0.35 + second * 0.35));
    view.setInt16(44 + index * bytesPerSample, sample * 0x7fff, true);
  }

  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]!);
  }

  return `data:audio/wav;base64,${btoa(binary)}`;
}

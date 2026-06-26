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
let messageAudio: HTMLAudioElement | null = null;
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
  preloadMessageSound();
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

export async function syncUnreadIndicators(totalUnread: number): Promise<void> {
  if (typeof document !== 'undefined') {
    document.title =
      totalUnread > 0 ? `(${formatBadgeCount(totalUnread)}) ${APP_TITLE}` : APP_TITLE;
  }

  if (!isBadgeSupported()) return;

  try {
    if (totalUnread > 0) {
      await navigator.setAppBadge!(totalUnread);
    } else {
      await navigator.clearAppBadge!();
    }
  } catch (err) {
    console.warn('app badge update failed', err);
  }
}

export async function clearUnreadIndicators(): Promise<void> {
  if (typeof document !== 'undefined') {
    document.title = APP_TITLE;
  }
  if (!isBadgeSupported()) return;
  try {
    await navigator.clearAppBadge!();
  } catch {
    // ignore
  }
}

function preloadMessageSound(): void {
  if (typeof Audio === 'undefined') return;
  if (messageAudio) return;
  messageAudio = new Audio(createMessageChimeDataUri());
  messageAudio.preload = 'auto';
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
  preloadMessageSound();

  if (messageAudio) {
    messageAudio.currentTime = 0;
    void messageAudio.play().catch(() => {
      playMessageSoundWithWebAudio();
    });
    return;
  }

  playMessageSoundWithWebAudio();
}

export function showMessageNotification(options: {
  conversationId: string;
  title: string;
  body: string;
}): void {
  const prefs = getAlertPrefs();
  if (!prefs.browserNotifications) return;
  if (!isNotificationSupported() || Notification.permission !== 'granted') return;

  void displayMessageNotification(options);
}

async function displayMessageNotification(options: {
  conversationId: string;
  title: string;
  body: string;
}): Promise<void> {
  const payload: NotificationOptions = {
    body: options.body,
    tag: `message-${options.conversationId}`,
    icon: '/icon.svg',
    badge: '/icon.svg',
    data: { conversationId: options.conversationId },
  };

  try {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification(options.title, payload);
      return;
    }
  } catch (err) {
    console.warn('service worker notification failed', err);
  }

  const notification = new Notification(options.title, payload);
  notification.onclick = () => {
    window.focus();
    notificationClickHandler?.(options.conversationId);
    notification.close();
  };
}

export function shouldAlertForIncomingMessage(options: {
  conversationId: string;
  selectedConversationId: string | null;
}): boolean {
  if (typeof document === 'undefined') return false;
  if (document.visibilityState === 'hidden') return true;
  if (!options.selectedConversationId) return true;
  return options.conversationId !== options.selectedConversationId;
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

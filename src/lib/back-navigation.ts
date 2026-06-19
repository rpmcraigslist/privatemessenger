import { useEffect, useRef } from 'react';

const BACK_GUARD_STATE = { messengerBackGuard: true as const };

/** Installed PWA / home-screen web app (not a normal browser tab). */
export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone ===
      true
  );
}

/** Phone-sized view where the OS back button/gesture should stay in-app. */
export function shouldInterceptSystemBack(): boolean {
  if (typeof window === 'undefined') return false;
  if (isStandalonePwa()) return true;
  return window.matchMedia('(max-width: 768px)').matches;
}

function seedHistoryGuard(): void {
  history.pushState(BACK_GUARD_STATE, '');
}

/** Call when opening a chat, modal, search panel, reply bar, etc. */
export function pushAppNavigationLayer(): void {
  if (!shouldInterceptSystemBack()) return;
  history.pushState(BACK_GUARD_STATE, '');
}

/** Same as tapping the in-app back control — walks history when intercepted. */
export function appNavigateBack(): boolean {
  if (!shouldInterceptSystemBack()) return false;
  history.back();
  return true;
}

/**
 * Wire the OS back button/gesture to in-app navigation (close overlays, leave
 * chat) instead of exiting the app or browser tab.
 */
export function useSystemBackNavigation(onPop: () => void): void {
  const onPopRef = useRef(onPop);
  onPopRef.current = onPop;

  useEffect(() => {
    if (!shouldInterceptSystemBack()) return;

    seedHistoryGuard();

    const onPopState = () => {
      onPopRef.current();
      seedHistoryGuard();
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
}

/** @deprecated use useSystemBackNavigation */
export const useStandaloneBackGuard = useSystemBackNavigation;

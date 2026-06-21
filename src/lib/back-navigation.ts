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

function retrapHistory(): void {
  history.pushState(BACK_GUARD_STATE, '');
}

/**
 * Wire the OS back button/gesture to in-app navigation (close overlays, leave
 * chat) instead of exiting the app or browser tab.
 *
 * Uses a single history trap — never stacks pushState per screen. Stacking
 * caused accidental "logout" when scroll/back gestures consumed multiple entries.
 */
export function useSystemBackNavigation(onPop: () => void): void {
  const onPopRef = useRef(onPop);
  onPopRef.current = onPop;

  useEffect(() => {
    if (!shouldInterceptSystemBack()) return;

    retrapHistory();

    const onPopState = () => {
      onPopRef.current();
      retrapHistory();
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
}

/** Same as tapping the in-app back control. */
export function appNavigateBack(): boolean {
  if (!shouldInterceptSystemBack()) return false;
  history.back();
  return true;
}

/** @deprecated No longer stacks history — kept so callers compile unchanged. */
export function pushAppNavigationLayer(): void {
  // Intentionally empty. Layer tracking caused history stack blow-up.
}

/** @deprecated use useSystemBackNavigation */
export const useStandaloneBackGuard = useSystemBackNavigation;

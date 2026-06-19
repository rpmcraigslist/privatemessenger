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

/**
 * Trap the system back gesture/button in installed PWAs so Android does not
 * show the "Exit app?" prompt. Runs the supplied handler first (close chat,
 * dismiss modals), then keeps the user in the app.
 */
export function useStandaloneBackGuard(onBack: () => boolean): void {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    if (!isStandalonePwa()) return;

    history.pushState(BACK_GUARD_STATE, '');

    const onPopState = () => {
      onBackRef.current();
      history.pushState(BACK_GUARD_STATE, '');
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
}

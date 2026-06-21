import { useEffect, useRef } from 'react';

const BACK_GUARD_STATE = { messengerBackGuard: true as const };

export type BackNavigationResult =
  | boolean
  | { handled: boolean; keepLayer?: boolean };

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

let backHandler: (() => BackNavigationResult) | null = null;
let layerPushed = false;
let suppressNextPop = false;

function parseBackResult(result: BackNavigationResult): {
  handled: boolean;
  keepLayer: boolean;
} {
  if (typeof result === 'boolean') {
    return { handled: result, keepLayer: false };
  }
  return {
    handled: result.handled,
    keepLayer: result.keepLayer ?? false,
  };
}

/** Push or pop a single history entry to mirror in-app overlay depth (chat/modals). */
export function syncBackHistoryLayer(needsLayer: boolean): void {
  if (!shouldInterceptSystemBack()) return;

  if (needsLayer) {
    if (!layerPushed) {
      history.pushState(BACK_GUARD_STATE, '');
      layerPushed = true;
    }
    return;
  }

  if (layerPushed) {
    suppressNextPop = true;
    history.back();
    layerPushed = false;
  }
}

/**
 * Wire the OS back button to in-app navigation. History is not trapped on load —
 * only when syncBackHistoryLayer(true) runs (chat open, modal open).
 */
export function useSystemBackNavigation(
  onPop: () => BackNavigationResult,
  needsLayer: boolean,
): void {
  const onPopRef = useRef(onPop);
  onPopRef.current = onPop;

  useEffect(() => {
    const handler = () => onPopRef.current();
    backHandler = handler;
    return () => {
      if (backHandler === handler) {
        backHandler = null;
      }
    };
  }, []);

  useEffect(() => {
    syncBackHistoryLayer(needsLayer);
  }, [needsLayer]);

  useEffect(() => {
    if (!shouldInterceptSystemBack()) return;

    const onPopState = () => {
      if (suppressNextPop) {
        suppressNextPop = false;
        return;
      }

      if (!layerPushed) return;

      layerPushed = false;
      const { handled, keepLayer } = parseBackResult(onPopRef.current());
      if (!handled) return;

      if (keepLayer) {
        history.pushState(BACK_GUARD_STATE, '');
        layerPushed = true;
      }
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
}

/** Run in-app back (close overlay / leave chat). Does not touch browser history. */
export function appNavigateBack(): boolean {
  if (!shouldInterceptSystemBack()) return false;
  return parseBackResult(backHandler?.() ?? false).handled;
}

/** @deprecated No longer stacks history — kept so callers compile unchanged. */
export function pushAppNavigationLayer(): void {
  // Intentionally empty.
}

/** @deprecated use useSystemBackNavigation */
export const useStandaloneBackGuard = useSystemBackNavigation;

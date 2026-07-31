import { registerSW } from 'virtual:pwa-register';
import { APP_VERSION } from './app-version';

const UPDATE_CHECK_INTERVAL_MS = 30_000;
const RECOVERY_FLAG = 'messenger:stale-asset-recovery';
const DEPLOY_VERSION_KEY = 'messenger:deploy-version';
const VERSION_RELOAD_FLAG = 'messenger:version-reload';

/** Unregister service workers and wipe Cache Storage, then reload once. */
export async function purgeServiceWorkerCachesAndReload(): Promise<void> {
  if (typeof window === 'undefined') return;

  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch (err) {
    console.error('failed to purge service worker caches', err);
  }

  // Bypass any remaining HTTP cache on the document.
  const url = new URL(window.location.href);
  url.searchParams.set('v', Date.now().toString(36));
  window.location.replace(url.toString());
}

function stylesheetFailedToLoad(): boolean {
  const links = document.querySelectorAll<HTMLLinkElement>(
    'link[rel="stylesheet"][href*="/assets/"]',
  );
  if (links.length === 0) return false;
  for (const link of links) {
    if (!link.sheet) return true;
  }
  return false;
}

/**
 * If a prior deploy left the tab on hashed assets that 404, wipe SW caches
 * and reload once so Windows browsers pick up the live build.
 */
export function recoverFromStaleDeployAssets(): void {
  if (typeof window === 'undefined') return;
  if (sessionStorage.getItem(RECOVERY_FLAG)) return;

  const run = () => {
    if (!stylesheetFailedToLoad()) return;
    sessionStorage.setItem(RECOVERY_FLAG, '1');
    console.warn(
      'Detected missing stylesheet (likely stale PWA cache). Clearing caches and reloading…',
    );
    void purgeServiceWorkerCachesAndReload();
  };

  if (document.readyState === 'complete') {
    window.setTimeout(run, 0);
  } else {
    window.addEventListener('load', () => window.setTimeout(run, 0), {
      once: true,
    });
  }
}

/** Compare live /version.json to this JS bundle; purge if the server is newer/different. */
export async function ensureLatestDeployVersion(): Promise<void> {
  if (typeof window === 'undefined') return;

  try {
    const response = await fetch(`/version.json?t=${Date.now()}`, {
      cache: 'no-store',
    });
    if (!response.ok) return;
    const payload = (await response.json()) as { version?: string };
    const remote = payload.version?.trim();
    if (!remote) return;

    localStorage.setItem(DEPLOY_VERSION_KEY, remote);

    if (remote === APP_VERSION) {
      sessionStorage.removeItem(VERSION_RELOAD_FLAG);
      return;
    }

    // Running an old JS bundle against a newer deploy — hard reset once.
    if (sessionStorage.getItem(VERSION_RELOAD_FLAG) === remote) return;
    sessionStorage.setItem(VERSION_RELOAD_FLAG, remote);
    console.warn(
      `Deploy version mismatch (local ${APP_VERSION}, server ${remote}). Clearing caches…`,
    );
    await purgeServiceWorkerCachesAndReload();
  } catch (err) {
    console.error('deploy version check failed', err);
  }
}

/**
 * Register the service worker, poll for new deploys, and reload once when a
 * newer worker takes control so PC/PWA clients leave the cached build.
 */
export function startPwaAutoUpdate(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  window.setTimeout(() => {
    if (!stylesheetFailedToLoad()) {
      sessionStorage.removeItem(RECOVERY_FLAG);
    }
  }, 2500);

  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;

      const checkForUpdate = () => {
        void registration.update();
        void ensureLatestDeployVersion();
      };

      window.setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          checkForUpdate();
        }
      });

      window.addEventListener('focus', checkForUpdate);
      checkForUpdate();
    },
    onRegisterError(error) {
      console.error('service worker registration failed', error);
    },
  });
}

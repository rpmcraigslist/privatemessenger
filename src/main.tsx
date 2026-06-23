import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { initAmplify } from './lib/amplify';
import { captureDeepLinkFromUrl } from './lib/deep-link';
import './index.css';
import App from './App';

captureDeepLinkFromUrl();

function BootstrapShell() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl items-center justify-center px-6 text-[var(--color-muted)]">
      Loading…
    </div>
  );
}

function Root() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    initAmplify()
      .catch((error) => {
        console.error('Amplify init failed', error);
      })
      .finally(() => {
        setReady(true);
      });
  }, []);

  if (!ready) return <BootstrapShell />;

  return (
    <StrictMode>
      <App />
    </StrictMode>
  );
}

createRoot(document.getElementById('root')!).render(<Root />);

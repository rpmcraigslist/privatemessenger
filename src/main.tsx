import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './lib/amplify';
import { captureDeepLinkFromUrl } from './lib/deep-link';
import './index.css';
import App from './App';

captureDeepLinkFromUrl();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

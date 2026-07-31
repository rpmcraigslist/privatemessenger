/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { messengerVersionJsonPlugin } from './scripts/vite-version-plugin';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    messengerVersionJsonPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      // Manual registerSW in src/lib/pwa-update.ts (avoid double registration).
      injectRegister: false,
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Private Messenger',
        short_name: 'Messenger',
        description: 'A private, real-time messenger.',
        theme_color: '#0b141a',
        background_color: '#0b141a',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: 'icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        // Do not precache the app shell. Precached HTML/JS is what kept PC
        // browsers stuck on Version 2.0 after newer deploys.
        globPatterns: [],
        // Keep a fallback path defined but allowlist nothing — never serve a
        // cached shell for navigations (NetworkOnly handles documents).
        navigateFallback: '/index.html',
        navigateFallbackAllowlist: [],
        importScripts: ['notification-sw.js'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          {
            // Always fetch the document from the network — never a cached shell.
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkOnly',
          },
          {
            urlPattern: /\/version\.json$/i,
            handler: 'NetworkOnly',
          },
          {
            urlPattern: /\/amplify_outputs\.json$/i,
            handler: 'NetworkOnly',
          },
          {
            urlPattern: /\/sw\.js$/i,
            handler: 'NetworkOnly',
          },
          {
            // Hashed assets: prefer network, fall back to cache only if offline.
            urlPattern: /\/assets\/.*\.(?:js|css)$/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'messenger-assets',
              expiration: {
                maxEntries: 32,
                maxAgeSeconds: 60 * 60 * 24 * 7,
              },
            },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});

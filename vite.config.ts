/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

/** Project directory, with a trailing slash. */
const root = new URL('.', import.meta.url).pathname;
const shim = (name: string) => `${root}shims/${name}`;

export default defineConfig(({mode}) => ({
  plugins: [react()],
  resolve: {
    alias: [
      // GramJS is written for Node; in the browser it needs these stand-ins
      // (its own browser crypto, and no-ops for modules it never calls there).
      {find: /^crypto$/, replacement: `${root}node_modules/telegram/crypto/crypto.js`},
      {find: /^path$/, replacement: 'path-browserify'},
      {find: /^os$/, replacement: shim('os.js')},
      {find: /^util$/, replacement: shim('util.js')},
      {find: /^(fs|net|socks|node-localstorage)$/, replacement: shim('empty.js')},
      // Parts of GramJS the app never uses: the HTML parse mode and the full MIME database.
      {find: /^htmlparser2$/, replacement: shim('htmlparser2.js')},
      {find: /^mime$/, replacement: shim('mime.js')},
      // The E2E build (`npm run build:e2e`) swaps the Telegram connection for
      // a scripted fake that the tests drive; the release build never has it.
      ...(mode === 'e2e'
        ? [{find: /^\.\/gramClient$/, replacement: `${root}tests/e2e/fakeTelegram.ts`}]
        : []),
    ],
  },
  build: {
    // The Lumen host runs the app in GeckoView (Firefox 156) or in the Android
    // system WebView (Chromium 95), so syntax and CSS are lowered for Chromium 95.
    target: ['chrome95', 'firefox115'],
    cssTarget: ['chrome95', 'firefox115'],
    // GramJS is a separate chunk loaded only for a real account.
    chunkSizeWarningLimit: 800,
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
}));

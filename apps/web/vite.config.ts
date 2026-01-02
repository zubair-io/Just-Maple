import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig({
  plugins: [
    wasm(),
    topLevelAwait({
      promiseExportName: '__tla',
      promiseImportName: (i) => `__tla_${i}`,
    }),
  ],
  optimizeDeps: {
    exclude: [
      '@automerge/automerge',
      '@automerge/automerge-repo',
      '@automerge/automerge-repo-network-websocket',
      '@automerge/automerge-repo-storage-indexeddb',
    ],
    esbuildOptions: {
      target: 'esnext',
    },
  },
  build: {
    target: 'esnext',
  },
  worker: {
    format: 'es',
    plugins: () => [wasm(), topLevelAwait()],
  },
  server: {
    fs: {
      allow: ['..', '../..'],
    },
  },
});

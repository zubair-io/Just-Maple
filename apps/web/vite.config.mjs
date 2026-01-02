/// <reference types="vitest" />

import { defineConfig } from 'vite';
import angular from '@analogjs/vite-plugin-angular';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  return {
    root: __dirname,
    publicDir: 'public',
    build: {
      outDir: '../../dist/apps/web',
      reportCompressedSize: true,
      target: 'esnext',
      commonjsOptions: {
        transformMixedEsModules: true,
      },
    },
    plugins: [
      angular({
        tsconfig: mode === 'test' ? './tsconfig.spec.json' : './tsconfig.app.json',
        workspaceRoot: '../../',
        inlineStylesExtension: 'scss',
      }),
      tailwindcss(),
      wasm(),
      topLevelAwait({
        promiseExportName: '__tla',
        promiseImportName: (i) => `__tla_${i}`,
      }),
    ],
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['src/test-setup.ts'],
      include: ['**/*.spec.ts'],
    },
    define: {
      'import.meta.vitest': mode !== 'production',
    },
    resolve: {
      mainFields: ['module'],
    },
    css: {
      preprocessorOptions: {
        scss: {
          api: 'modern-compiler',
          includePaths: ['src'],
        },
      },
    },
    optimizeDeps: {
      include: ['@angular/common', '@angular/forms'],
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
    worker: {
      format: 'es',
      plugins: () => [wasm(), topLevelAwait()],
    },
    server: {
      fs: {
        allow: ['..', '../..'],
      },
      port: 4200,
      host: '0.0.0.0',
      proxy: {
        '/api': {
          target: 'http://localhost:7071',
          changeOrigin: true,
        },
        '/ws': {
          target: 'ws://localhost:7071',
          ws: true,
        },
      },
    },
  };
});

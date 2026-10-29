/// <reference types="vitest" />
import { defineConfig } from 'vite';
import angular from '@analogjs/vite-plugin-angular';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [angular({ jit: true, zoneless: true })],
  resolve: {
    dedupe: [
      'vitest',
      '@angular/core',
      '@angular/common',
      '@angular/compiler',
      '@angular/platform-browser',
    ],
    alias: {
      vitest: fileURLToPath(new URL('./node_modules/vitest/dist/index.js', import.meta.url)),
    },
  },
  test: {
    name: 'web',
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.spec.ts', 'src/**/*.test.ts'],
    setupFiles: ['src/test-init.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/test-init.ts', 'src/main.ts'],
    },
    server: {
      deps: {
        inline: [/@angular/, /@simplewebauthn/, /@analogjs/, /@tiptap/],
      },
    },
  },
});

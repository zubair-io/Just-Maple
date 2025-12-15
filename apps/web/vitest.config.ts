/// <reference types="vitest" />
import { defineConfig } from 'vite';
import angular from '@analogjs/vite-plugin-angular';

export default defineConfig({
  plugins: [angular({ jit: true, zoneless: true })],
  test: {
    name: 'web',
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.spec.ts'],
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

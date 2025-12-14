import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        name: 'api',
        globals: true,
        environment: 'node',
        setupFiles: ['./src/__tests__/setup.ts'],
        include: ['src/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            include: ['src/**/*.ts'],
            exclude: ['src/**/*.test.ts', 'src/__tests__/**'],
        },
        testTimeout: 60000,
        hookTimeout: 60000,
        sequence: {
            shuffle: false,
        },
        fileParallelism: false,
    },
});

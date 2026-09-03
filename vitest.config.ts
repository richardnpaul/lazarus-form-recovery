import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'src/common/**/*.ts',
        'src/background/**/*.ts',
        'src/content/**/*.ts',
        'src/popup/**/*.ts',
        'src/sidepanel/**/*.ts',
        'src/options/**/*.ts',
      ],
      exclude: [
        'src/vite-env.d.ts',
        'src/background/index.ts',
        'src/content/index.ts',
      ],
    },
  },
});

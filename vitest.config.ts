import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.ts',
    include: [
      'src/**/*.test.{ts,tsx}',
      'src/__tests__/**/*.test.{ts,tsx}',
    ],
    coverage: {
      reporter: ['text', 'lcov'],
    },
  },
});

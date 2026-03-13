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
      include: [
        'src/services/api.ts',
        'src/views/IntegrationsStep.tsx',
        'src/views/InventoryView.tsx',
        'src/views/MasterListStep.tsx',
        'src/views/OnboardingFlow.tsx',
        'src/views/SupplierSetup.tsx',
        'src/views/UrlScrapeStep.tsx',
        'src/views/supplierSetupUtils.ts',
      ],
      reporter: ['text', 'lcov'],
      thresholds: {
        lines: 40,
        statements: 40,
        functions: 40,
        branches: 40,
      },
    },
  },
});

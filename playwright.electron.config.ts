import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/ui',
  testMatch: '**/*.pw.ts',
  timeout: 30_000,
  workers: 1,
  reporter: 'line',
});

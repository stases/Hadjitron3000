import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';

export default defineConfig({
  base: './',
  cacheDir: '.cache/vite',
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: true },
  test: {
    // A slow CI machine can miss the timing bounds of a few audio tests; each failure gets one more try there.
    retry: process.env.CI ? 1 : 0,
    // Only the plain report: on GitHub, vitest would add an annotation for every failure and every retry of it, which
    // uses up the few a step may have before scripts/ci-step.mjs lists the failed tests.
    reporters: ['default'],
    projects: [
      {
        extends: true,
        test: { name: 'unit', environment: 'node', include: ['tests/unit/**/*.test.ts'] },
      },
      {
        extends: true,
        test: {
          name: 'browser',
          include: ['tests/browser/**/*.test.{ts,tsx}'],
          browser: {
            enabled: true,
            headless: true,
            screenshotFailures: false,
            provider: playwright({
              launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
            }),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});

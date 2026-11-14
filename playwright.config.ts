import { defineConfig } from '@playwright/test';

const PORT = 4173;
// With HADJITRON_EXE the Electron tests drive that installed application instead of this checkout, and the app
// tests are not run, so nothing needs serving.
const installed = !!process.env.HADJITRON_EXE;

export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  reporter: 'list',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  webServer: installed ? undefined : {
    command: `npx vite build && npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    timeout: 180_000,
  },
  projects: [
    { name: 'electron', testMatch: 'electron.spec.ts' },
    ...(installed ? [] : [{
      name: 'app',
      testMatch: 'app.spec.ts',
      use: {
        browserName: 'chromium' as const,
        baseURL: `http://127.0.0.1:${PORT}`,
        acceptDownloads: true,
        launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
      },
    }]),
  ],
});

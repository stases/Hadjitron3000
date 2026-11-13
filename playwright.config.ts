import { defineConfig } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  reporter: 'list',
  timeout: 60_000,
  webServer: {
    command: `npx vite build && npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    timeout: 180_000,
  },
  projects: [
    { name: 'electron', testMatch: 'electron.spec.ts' },
    {
      name: 'app',
      testMatch: 'app.spec.ts',
      use: {
        browserName: 'chromium',
        baseURL: `http://127.0.0.1:${PORT}`,
        acceptDownloads: true,
        launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
      },
    },
  ],
});

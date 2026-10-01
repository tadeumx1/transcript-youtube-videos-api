import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './browser',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4173', headless: true },
  webServer: {
    command: 'npm run dev:web -- --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
  reporter: 'list',
})

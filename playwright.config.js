import { defineConfig } from "playwright/test";

// Fixed port so config reloads (workers / retries) keep the same baseURL as webServer.
const PORT = Number(process.env.E2E_PORT || 18765);

export default defineConfig({
  testDir: "./test/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: `https://127.0.0.1:${PORT}`,
    ignoreHTTPSErrors: true,
    trace: "on-first-retry",
  },
  webServer: {
    command: `node scripts/serve.mjs src ${PORT}`,
    url: `https://127.0.0.1:${PORT}/`,
    ignoreHTTPSErrors: true,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});

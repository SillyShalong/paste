import { defineConfig } from "@playwright/test";

// UI tests run the real panel frontend in headless Chromium against the
// vite dev server, with the Tauri IPC layer mocked (see tests/ui/mock.mjs).
// `reuseExistingServer` lets a manually started `npm run dev` be reused.
export default defineConfig({
  testDir: "tests/ui",
  timeout: 20_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:5173",
    viewport: { width: 1280, height: 640 },
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});

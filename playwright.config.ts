import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser", fullyParallel: false, workers: 1, retries: 0,
  timeout: 60_000, reporter: "list",
  use: { baseURL: process.env.BROWSER_TEST_URL, ignoreHTTPSErrors: true,
    trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
});

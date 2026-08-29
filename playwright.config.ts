import { defineConfig, devices } from "@playwright/test";

const PORT = 3100; // never collides with `next dev` on 3000

/**
 * E2E runs against a production build with dummy backend env. Every value
 * below is fake: the suite only exercises paths that never reach Postgres,
 * Redis, or Anthropic (login page, auth gate, webhook signature rejection,
 * cron 401s). Modules like src/lib/db throw at import if these are unset,
 * which is why they must be present at all.
 */
const env = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  KV_REST_API_URL: "https://example.invalid",
  KV_REST_API_TOKEN: "x",
  INVITE_CODE: "e2e-invite",
  ANTHROPIC_WEBHOOK_SIGNING_KEY: "whsec_MC047Od10xjn3TuSCqPak6ejqBdeeyGIhB8kJOi7o1Q=",
  CRON_SECRET: "e2e-cron",
  ANTHROPIC_API_KEY: "sk-ant-dummy",
  FMP_API_KEY: "x",
  MASSIVE_API_KEY: "x",
};

export default defineConfig({
  testDir: "e2e",
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env,
  },
});

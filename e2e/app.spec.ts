import { expect, test } from "@playwright/test";

/**
 * These tests run against a production build with dummy backend env (see
 * playwright.config.ts). They only touch paths that never query Postgres,
 * Redis, or Anthropic: the login page, the auth gate in src/proxy.ts, webhook
 * signature rejection, and cron bearer checks.
 */

const INVITE_CODE = "e2e-invite"; // must match playwright.config.ts webServer.env
const SESSION_COOKIE = "tfyi_session";

test.describe("auth gate", () => {
  test("unauthenticated / shows the login form and keeps the URL at /", async ({ page }) => {
    await page.goto("/");
    expect(new URL(page.url()).pathname).toBe("/");
    await expect(page.locator("input[name=code]")).toBeVisible();
    await expect(page.getByRole("button", { name: "Enter" })).toBeVisible();
  });

  test("/?invite=abc prefills the invite code", async ({ page }) => {
    await page.goto("/?invite=abc");
    expect(new URL(page.url()).pathname).toBe("/");
    await expect(page.locator("input[name=code]")).toHaveValue("abc");
  });

  test("unauthenticated page redirects to /login?next=<path>", async ({ page }) => {
    await page.goto("/s/NVDA");
    const url = new URL(page.url());
    expect(url.pathname).toBe("/login");
    expect(url.search).toBe("?next=%2Fs%2FNVDA");
    await expect(page.locator("input[name=code]")).toBeVisible();
  });

  test("unauthenticated API route is redirected to login", async ({ request }) => {
    const res = await request.get("/api/smoke/sesn_x", { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    const location = new URL(res.headers()["location"], "http://localhost");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/api/smoke/sesn_x");
  });
});

test.describe("login", () => {
  test("wrong code shows an error and sets no session cookie", async ({ page, context }) => {
    await page.goto("/login");
    await page.locator("input[name=code]").fill("definitely-not-it");
    await page.getByRole("button", { name: "Enter" }).click();
    await expect(page.getByText("That invite code didn't work.")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/login");
    const cookies = await context.cookies();
    expect(cookies.find((c) => c.name === SESSION_COOKIE)).toBeUndefined();
  });

  test("right code sets an httpOnly session cookie and lands on /", async ({ page, context }) => {
    await page.goto("/login");
    await page.locator("input[name=code]").fill(INVITE_CODE);
    await page.getByRole("button", { name: "Enter" }).click();
    // `/` will try Postgres and fail with the dummy DATABASE_URL — that is
    // expected here, so assert the login outcome via URL + cookie only.
    await page.waitForURL((u) => u.pathname === "/");
    const session = (await context.cookies()).find((c) => c.name === SESSION_COOKIE);
    expect(session).toBeDefined();
    expect(session?.httpOnly).toBe(true);
    expect(session?.value).toMatch(/^[0-9a-f]{64}$/);
  });
});

test.describe("machine endpoints", () => {
  test("POST /webhook without a signature is rejected with 400", async ({ request }) => {
    const res = await request.post("/webhook", {
      data: "{}",
      headers: { "content-type": "application/json" },
    });
    expect(res.status()).toBe(400);
    expect(await res.text()).toBe("invalid signature");
  });

  test("GET /api/cron/reconcile without a valid bearer is 401", async ({ request }) => {
    const missing = await request.get("/api/cron/reconcile");
    expect(missing.status()).toBe(401);

    const wrong = await request.get("/api/cron/reconcile", {
      headers: { authorization: "Bearer not-the-secret" },
    });
    expect(wrong.status()).toBe(401);
  });
});

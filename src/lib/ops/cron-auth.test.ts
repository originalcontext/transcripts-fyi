import { afterEach, describe, expect, it } from "vitest";

import { isCronAuthorized } from "./cron-auth";

const req = (auth?: string) => new Request("https://x.test/api/cron/reconcile", { headers: auth ? { authorization: auth } : {} });

describe("isCronAuthorized — fails closed", () => {
  const prev = process.env.CRON_SECRET;
  afterEach(() => {
    if (prev === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prev;
  });
  it("rejects everything when no secret is configured", () => {
    delete process.env.CRON_SECRET;
    expect(isCronAuthorized(req("Bearer anything"))).toBe(false);
  });
  it("accepts only the exact bearer", () => {
    process.env.CRON_SECRET = "s3cret";
    expect(isCronAuthorized(req("Bearer s3cret"))).toBe(true);
    expect(isCronAuthorized(req("Bearer s3cre"))).toBe(false);
    expect(isCronAuthorized(req("Bearer s3cret!"))).toBe(false);
    expect(isCronAuthorized(req("s3cret"))).toBe(false);
    expect(isCronAuthorized(req())).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import { isNotFound } from "./errors";

describe("isNotFound", () => {
  it("is true only for a 404 status", () => {
    expect(isNotFound({ status: 404 })).toBe(true);
    expect(isNotFound({ status: 429 })).toBe(false);
    expect(isNotFound({ status: 503 })).toBe(false);
    expect(isNotFound(new Error("fetch failed"))).toBe(false);
    expect(isNotFound(null)).toBe(false);
  });
});

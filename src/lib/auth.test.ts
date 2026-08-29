import { describe, expect, it } from "vitest";

import { safeNext } from "./auth";

describe("safeNext — post-login redirect stays on this origin", () => {
  it("keeps ordinary paths", () => {
    expect(safeNext("/")).toBe("/");
    expect(safeNext("/s/NVDA")).toBe("/s/NVDA");
    expect(safeNext("/api/smoke/x?y=1")).toBe("/api/smoke/x?y=1");
  });
  it("rejects protocol-relative, backslash, and absolute forms", () => {
    for (const bad of ["//evil.com", "/\\evil.com", "/a\\b", "https://evil.com", "evil.com", ""]) expect(safeNext(bad)).toBe("/");
  });
});

import { describe, expect, it } from "vitest";

import { ARTIFACT_LIBS, injectArtifactHead } from "./imports";

describe("injectArtifactHead", () => {
  it("paints dark first, then loads exactly the pinned libraries, right after <head>", () => {
    const out = injectArtifactHead("<!doctype html><html><head><title>x</title></head><body></body></html>");
    const head = out.slice(out.indexOf("<head>") + 6, out.indexOf("<title>"));
    expect(head.indexOf("color-scheme")).toBeLessThan(head.indexOf("<script"));
    for (const lib of ARTIFACT_LIBS) expect(head).toContain(`src="${lib.src}"`);
    expect((head.match(/<script/g) ?? []).length).toBe(ARTIFACT_LIBS.length);
    expect(head).toMatch(/<script defer src="https:\/\/cdn\.jsdelivr\.net\/npm\/alpinejs/);
  });
  it("pins every library to an exact version on jsDelivr", () => {
    for (const lib of ARTIFACT_LIBS) expect(lib.src).toMatch(/^https:\/\/cdn\.jsdelivr\.net\/npm\/[^@]+@\d+\.\d+\.\d+\//);
  });
  it("prepends when the document has no <head>", () => {
    expect(injectArtifactHead("<p>hi</p>").startsWith("<meta")).toBe(true);
  });
});

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/anthropic", () => ({ anthropic: {}, deployTarget: () => "dev" }));
vi.mock("@/lib/redis", () => ({ redis: {}, key: (...p: string[]) => p.join(":") }));

import { configHashFor, type StackSpec } from "./stack";

const spec: StackSpec = {
  app: "tfyi",
  role: "distiller",
  target: "dev",
  environment: { name: "e", description: "" },
  skill: { name: "s", markdown: "# skill" },
  agent: { name: "a", description: "", system: "sys", model: { id: "claude-opus-5", effort: "high" }, tools: [] },
};

describe("config hash — the versioning key", () => {
  it("is stable for identical config and changes when skill text, prompt, model, or tools change", () => {
    const base = configHashFor(spec);
    expect(configHashFor({ ...spec })).toBe(base);
    expect(configHashFor({ ...spec, skill: { ...spec.skill, markdown: "# skill v2" } })).not.toBe(base);
    expect(configHashFor({ ...spec, agent: { ...spec.agent, system: "sys2" } })).not.toBe(base);
    expect(configHashFor({ ...spec, agent: { ...spec.agent, model: { id: "claude-opus-5", effort: "low" } } })).not.toBe(base);
    expect(configHashFor({ ...spec, agent: { ...spec.agent, tools: [{ type: "custom", name: "t", description: "d", input_schema: { type: "object" } }] } })).not.toBe(base);
  });
  it("ignores names/descriptions/target — they don't change what a session does", () => {
    const base = configHashFor(spec);
    expect(configHashFor({ ...spec, target: "prod", environment: { name: "x", description: "y" } })).toBe(base);
  });
  it("pins the hash format (changing the key names would silently re-version every agent)", () => {
    expect(configHashFor(spec)).toMatch(/^[0-9a-f]{16}$/);
  });
});

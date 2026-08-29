import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {}, schema: {} }));
vi.mock("@/lib/anthropic", () => ({ anthropic: {}, deployTarget: () => "dev" }));
vi.mock("@/lib/redis", () => ({ redis: {}, key: (...p: string[]) => p.join(":") }));

import { planNudge } from "./reconcile";

describe("planNudge — the hung-run state machine", () => {
  it("does nothing while the session is idle or recently active", () => {
    expect(planNudge("idle", 999, 0)).toBeNull();
    expect(planNudge("running", 5, 0)).toBeNull();
    expect(planNudge("running", 20, 0)).toBeNull(); // threshold is exclusive
  });
  it("escalates: interrupt → continue → give up, then stays at give-up", () => {
    expect(planNudge("running", 21, 0)).toBe("interrupt");
    expect(planNudge("running", 21, 1)).toBe("continue");
    expect(planNudge("running", 21, 2)).toBe("give-up");
    expect(planNudge("running", 21, 7)).toBe("give-up");
  });
});

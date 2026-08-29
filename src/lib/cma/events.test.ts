import { describe, expect, it } from "vitest";

import fixture from "./__fixtures__/distill-session-events.json";
import { deriveRunStatus, latestStopReason, type SessionEvent, unansweredToolUses } from "./events";

// A real NVDA distillation log (payload strings trimmed): 10 custom tool
// calls, 10 results, ends with session.status_idle end_turn.
const log = fixture as unknown as SessionEvent[];
const withoutLastResult = () => {
  const i = log.map((e) => e.type).lastIndexOf("user.custom_tool_result");
  return log.filter((_, idx) => idx !== i);
};

describe("unansweredToolUses", () => {
  it("is empty on a fully settled log", () => {
    expect(unansweredToolUses(log)).toEqual([]);
  });

  it("finds exactly the call whose result is missing", () => {
    const events = withoutLastResult();
    const pending = unansweredToolUses(events);
    expect(pending).toHaveLength(1);
    const id = pending[0].id;
    expect(events.some((e) => e.type === "user.custom_tool_result" && e.custom_tool_use_id === id)).toBe(false);
  });

  it("is idempotent under duplicate and reordered deliveries", () => {
    const shuffled = [...withoutLastResult()].reverse();
    const doubled = [...shuffled, ...shuffled];
    expect(unansweredToolUses(doubled).map((e) => e.id)).toEqual(
      [...new Set(unansweredToolUses(shuffled).map((e) => e.id))].flatMap((id) => [id, id]),
    );
    expect(new Set(unansweredToolUses(doubled).map((e) => e.id)).size).toBe(1);
  });
});

describe("deriveRunStatus", () => {
  it("reads end_turn as idle", () => {
    expect(latestStopReason(log)).toBe("end_turn");
    expect(deriveRunStatus("idle", log)).toBe("idle");
  });

  it("stays working while a tool call is owed, and right after we answer it", () => {
    const beforeFinalIdle = log.slice(0, log.map((e) => e.type).lastIndexOf("session.status_idle"));
    expect(latestStopReason(beforeFinalIdle)).toBe("requires_action");
    expect(deriveRunStatus("idle", beforeFinalIdle)).toBe("working");
    expect(deriveRunStatus("idle", log, true)).toBe("working");
  });

  it("maps terminal and budget states", () => {
    const idle = (type: string) => [{ id: "x", type: "session.status_idle", processed_at: "", stop_reason: { type } }] as unknown as SessionEvent[];
    expect(deriveRunStatus("terminated", log)).toBe("ended");
    expect(deriveRunStatus("idle", idle("budget_reached"))).toBe("budget_reached");
    expect(deriveRunStatus("idle", idle("retries_exhausted"))).toBe("ended");
    expect(deriveRunStatus("running", log)).toBe("working");
    expect(deriveRunStatus("rescheduling", log)).toBe("working");
  });
});

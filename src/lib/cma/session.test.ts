import { describe, expect, it, vi } from "vitest";

const { send } = vi.hoisted(() => ({ send: vi.fn(async () => ({})) }));
vi.mock("@/lib/anthropic", () => ({ anthropic: { beta: { sessions: { events: { send, list: vi.fn() } } } }, deployTarget: () => "dev" }));

import fixture from "./__fixtures__/distill-session-events.json";
import { type SessionEvent } from "./events";
import { answerPendingTools, quietMinutes } from "./session";

const log = fixture as unknown as SessionEvent[];
const withoutLastResult = () => log.filter((_, i) => i !== log.map((e) => e.type).lastIndexOf("user.custom_tool_result"));

describe("answerPendingTools", () => {
  it("sends nothing when nothing is pending", async () => {
    send.mockClear();
    expect(await answerPendingTools("sesn_x", log, async () => ({ result: {}, isError: false }))).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it("answers every pending call in ONE send, keyed by the tool-use event id", async () => {
    send.mockClear();
    const events = withoutLastResult();
    const names = await answerPendingTools("sesn_x", events, async (call) => ({ result: { ok: call.name }, isError: false }));
    expect(names).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(1);
    const [, body] = send.mock.calls[0] as unknown as [string, { events: { type: string; custom_tool_use_id: string; is_error: boolean }[] }];
    expect(body.events).toHaveLength(1);
    expect(body.events[0].type).toBe("user.custom_tool_result");
    expect(body.events[0].is_error).toBe(false);
    expect(events.some((e) => e.type === "agent.custom_tool_use" && e.id === body.events[0].custom_tool_use_id)).toBe(true);
  });

  it("turns a throwing runner into an is_error result — the agent is never left waiting", async () => {
    send.mockClear();
    await answerPendingTools("sesn_x", withoutLastResult(), async () => {
      throw new Error("FMP down");
    });
    const [, body] = send.mock.calls[0] as unknown as [string, { events: { is_error: boolean; content: { text: string }[] }[] }];
    expect(body.events[0].is_error).toBe(true);
    expect(body.events[0].content[0].text).toContain("FMP down");
  });
});

describe("quietMinutes", () => {
  it("measures from the latest processed event, falling back to session creation", () => {
    const created = "2026-08-29T10:00:00.000Z";
    const now = Date.parse("2026-08-29T10:30:00.000Z");
    expect(quietMinutes([], created, now)).toBe(30);
    const ev = [{ id: "a", type: "session.status_running", processed_at: "2026-08-29T10:25:00.000Z" }] as unknown as SessionEvent[];
    expect(quietMinutes(ev, created, now)).toBe(5);
  });
});

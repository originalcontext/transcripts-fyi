import type Anthropic from "@anthropic-ai/sdk";

import type { RunStatus } from "@/lib/db/schema";

/**
 * Pure functions over a session's event log. No I/O, no env — this is the
 * idempotency core the webhook relies on, so it is unit-tested against a
 * real captured event log (see events.test.ts).
 */

export type SessionEvent = Anthropic.Beta.Sessions.BetaManagedAgentsSessionEvent;
export type CustomToolUse = Extract<SessionEvent, { type: "agent.custom_tool_use" }>;
export type StopReason = "requires_action" | "end_turn" | "retries_exhausted" | "budget_reached";
export type SessionStatus = "rescheduling" | "running" | "idle" | "terminated";
export type { RunStatus } from "@/lib/db/schema";

/** Custom-tool calls that have no matching `user.custom_tool_result` yet. */
export function unansweredToolUses(events: SessionEvent[]): CustomToolUse[] {
  const answered = new Set(events.flatMap((e) => (e.type === "user.custom_tool_result" ? [e.custom_tool_use_id] : [])));
  return events.filter((e): e is CustomToolUse => e.type === "agent.custom_tool_use" && !answered.has(e.id));
}

/** stop_reason of the latest session-level idle, if any. */
export function latestStopReason(events: SessionEvent[]): StopReason | null {
  const idle = events.filter((e) => e.type === "session.status_idle").at(-1);
  return idle?.type === "session.status_idle" ? idle.stop_reason.type : null;
}

/**
 * What the mainline should believe about a run, from the session resource.
 * `answeredNow`: we just sent tool results in this pass, so the agent is
 * about to resume even though the session still reads idle.
 */
export function deriveRunStatus(sessionStatus: SessionStatus, events: SessionEvent[], answeredNow = false): RunStatus {
  if (sessionStatus === "terminated") return "ended";
  if (answeredNow || sessionStatus !== "idle") return "working";
  switch (latestStopReason(events)) {
    case "budget_reached":
      return "budget_reached";
    case "retries_exhausted":
      return "ended";
    case "end_turn":
      return "idle";
    default:
      return "working"; // requires_action (or no idle yet): someone still owes the agent an answer
  }
}

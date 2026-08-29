import { anthropic, deployTarget } from "@/lib/anthropic";
import { answerPendingTools, listAllEvents } from "@/lib/cma/session";
import { runTool } from "@/lib/smoke/tools";

/**
 * Smoke test — the custom-tool half.
 *
 * When the agent calls a custom tool the session idles with stop_reason
 * `requires_action` and Anthropic fires a webhook. The handler calls
 * `settlePingPongSession`, which answers every unanswered call and returns.
 *
 * Safe under the webhook's delivery guarantees (duplicates, reordering, drops):
 * state is always read from the session's event log, never inferred from
 * which webhook arrived.
 */

export const SMOKE_KIND = "ping-pong";

export type SettleResult =
  | { action: "skipped"; reason: "not-smoke" | "other-target" | "nothing-pending" | "session-terminal" }
  | { action: "answered"; tools: string[] };

export async function settlePingPongSession(sessionId: string): Promise<SettleResult> {
  const session = await anthropic.beta.sessions.retrieve(sessionId);
  if (session.metadata?.smoke !== SMOKE_KIND) return { action: "skipped", reason: "not-smoke" };
  if (session.metadata?.target !== deployTarget())
    return { action: "skipped", reason: "other-target" };
  if (session.status === "terminated" || session.archived_at) return { action: "skipped", reason: "session-terminal" };

  const tools = await answerPendingTools(sessionId, await listAllEvents(sessionId), (call) => runTool(call.name, call.input));
  if (tools.length === 0) return { action: "skipped", reason: "nothing-pending" };
  return { action: "answered", tools };
}

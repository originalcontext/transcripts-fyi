import { anthropic, deployTarget } from "@/lib/anthropic";
import { type SessionEvent, unansweredToolUses } from "@/lib/cma/events";
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

export async function listAllEvents(sessionId: string): Promise<SessionEvent[]> {
  const events: SessionEvent[] = [];
  for await (const e of anthropic.beta.sessions.events.list(sessionId)) events.push(e);
  return events;
}

export type SettleResult =
  | { action: "skipped"; reason: "not-smoke" | "other-target" | "nothing-pending" }
  | { action: "answered"; tools: string[] };

export async function settlePingPongSession(sessionId: string): Promise<SettleResult> {
  const session = await anthropic.beta.sessions.retrieve(sessionId);
  if (session.metadata?.smoke !== SMOKE_KIND) return { action: "skipped", reason: "not-smoke" };
  if (session.metadata?.target !== deployTarget())
    return { action: "skipped", reason: "other-target" };

  const pending = unansweredToolUses(await listAllEvents(sessionId));
  if (pending.length === 0) return { action: "skipped", reason: "nothing-pending" };

  const results = await Promise.all(
    pending.map(async (call) => {
      const { result, isError } = await runTool(call.name, call.input).catch((err: unknown) => ({
        result: { error: err instanceof Error ? err.message : String(err) },
        isError: true,
      }));
      return {
        type: "user.custom_tool_result" as const,
        custom_tool_use_id: call.id,
        is_error: isError,
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    }),
  );

  // All results in one send — the agent may have issued parallel calls.
  await anthropic.beta.sessions.events.send(sessionId, { events: results });
  return { action: "answered", tools: pending.map((c) => c.name) };
}

import { anthropic } from "@/lib/anthropic";
import { type CustomToolUse, type SessionEvent, unansweredToolUses } from "@/lib/cma/events";

/** Full event log of a session (paginated by the SDK). */
export async function listAllEvents(sessionId: string): Promise<SessionEvent[]> {
  const events: SessionEvent[] = [];
  for await (const e of anthropic.beta.sessions.events.list(sessionId)) events.push(e);
  return events;
}

type ToolResult = { result: unknown; isError: boolean };
export type ToolRunner = (call: CustomToolUse) => Promise<ToolResult>;

/**
 * Answer every unanswered custom-tool call in one send. A runner that throws
 * becomes an `is_error` result — the agent is told, never left waiting. Returns
 * the tool names answered (empty when nothing was pending).
 */
export async function answerPendingTools(sessionId: string, events: SessionEvent[], run: ToolRunner): Promise<string[]> {
  const pending = unansweredToolUses(events);
  if (pending.length === 0) return [];
  const results = await Promise.all(
    pending.map(async (call) => {
      const { result, isError } = await run(call).catch((err: unknown): ToolResult => ({
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
  await anthropic.beta.sessions.events.send(sessionId, { events: results });
  return pending.map((c) => c.name);
}

/** Minutes since the session's last processed event — the session's own clock, not ours. */
export function quietMinutes(events: SessionEvent[], createdAt: string, now = Date.now()): number {
  const last = events.reduce((m, e) => Math.max(m, e.processed_at ? Date.parse(e.processed_at) : 0), Date.parse(createdAt));
  return (now - last) / 60_000;
}

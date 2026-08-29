import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, deployTarget } from "@/lib/anthropic";

/**
 * Ping-pong smoke test — the custom-tool half.
 *
 * The agent (see scripts/smoke/setup.ts) has one custom tool, `pong`. When it
 * calls it, the session idles with stop_reason `requires_action` and Anthropic
 * fires a webhook. The webhook handler calls `settlePingPongSession`, which
 * answers every unanswered `pong` call and returns.
 *
 * Designed to be safe under the webhook's delivery guarantees: duplicates,
 * out-of-order arrival, and no delivery at all. State is always read from the
 * session's event log, never inferred from which webhook arrived.
 */

export const SMOKE_KIND = "ping-pong";
export const PONG_TOOL = "pong";

type SessionEvent = Anthropic.Beta.Sessions.BetaManagedAgentsSessionEvent;
type CustomToolUse = Extract<SessionEvent, { type: "agent.custom_tool_use" }>;

export function pong(input: unknown) {
  const nonce =
    typeof input === "object" && input !== null && "nonce" in input
      ? String((input as { nonce: unknown }).nonce)
      : null;
  return {
    reply: "pong",
    nonce,
    handled_by: deployTarget(),
    handled_at: new Date().toISOString(),
  };
}

export async function listAllEvents(sessionId: string): Promise<SessionEvent[]> {
  const events: SessionEvent[] = [];
  for await (const e of anthropic.beta.sessions.events.list(sessionId)) events.push(e);
  return events;
}

/** Custom-tool calls that have no matching `user.custom_tool_result` yet. */
export function unansweredToolUses(events: SessionEvent[]): CustomToolUse[] {
  const answered = new Set(
    events.flatMap((e) => (e.type === "user.custom_tool_result" ? [e.custom_tool_use_id] : [])),
  );
  return events.filter(
    (e): e is CustomToolUse => e.type === "agent.custom_tool_use" && !answered.has(e.id),
  );
}

export type SettleResult =
  | { action: "skipped"; reason: "not-smoke" | "other-target" | "nothing-pending" }
  | { action: "answered"; toolUseIds: string[] };

export async function settlePingPongSession(sessionId: string): Promise<SettleResult> {
  const session = await anthropic.beta.sessions.retrieve(sessionId);
  if (session.metadata?.smoke !== SMOKE_KIND) return { action: "skipped", reason: "not-smoke" };
  if (session.metadata?.target !== deployTarget())
    return { action: "skipped", reason: "other-target" };

  const pending = unansweredToolUses(await listAllEvents(sessionId));
  if (pending.length === 0) return { action: "skipped", reason: "nothing-pending" };

  // All results in one send — the agent may have issued parallel calls.
  await anthropic.beta.sessions.events.send(sessionId, {
    events: pending.map((call) => {
      const isPong = call.name === PONG_TOOL;
      return {
        type: "user.custom_tool_result" as const,
        custom_tool_use_id: call.id,
        is_error: !isPong,
        content: [
          {
            type: "text" as const,
            text: isPong
              ? JSON.stringify(pong(call.input))
              : `Unknown tool: ${call.name}`,
          },
        ],
      };
    }),
  });

  return { action: "answered", toolUseIds: pending.map((c) => c.id) };
}

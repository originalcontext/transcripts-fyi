import { eq } from "drizzle-orm";
import { anthropic, deployTarget } from "@/lib/anthropic";
import { db, schema } from "@/lib/db";
import { APP } from "@/lib/distill/stack";
import { runDistillTool } from "@/lib/distill/tools";
import { listAllEvents, unansweredToolUses } from "@/lib/smoke/ping-pong";

export type DistillSettle =
  | { action: "skipped"; reason: "not-ours" | "other-target" | "unknown-run" | "nothing-pending" }
  | { action: "answered"; runId: string; tools: string[] };

/** Webhook entry point for distiller sessions: answer whatever tool calls are pending. */
export async function settleDistillSession(sessionId: string): Promise<DistillSettle> {
  const session = await anthropic.beta.sessions.retrieve(sessionId);
  const m = session.metadata ?? {};
  if (m.app !== APP || !m.run_id) return { action: "skipped", reason: "not-ours" };
  if (m.target !== deployTarget()) return { action: "skipped", reason: "other-target" };

  const [run] = await db.select().from(schema.runs).where(eq(schema.runs.id, m.run_id));
  if (!run) return { action: "skipped", reason: "unknown-run" };

  const pending = unansweredToolUses(await listAllEvents(sessionId));
  if (pending.length === 0) return { action: "skipped", reason: "nothing-pending" };

  const results = await Promise.all(
    pending.map(async (call) => {
      const ctx = { runId: run.id, subjectId: run.subjectId, toolUseId: call.id };
      const { result, isError } = await runDistillTool(ctx, call.name, call.input).catch((err: unknown) => ({
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
  await db.update(schema.runs).set({ lastActivityAt: new Date() }).where(eq(schema.runs.id, run.id));
  return { action: "answered", runId: run.id, tools: pending.map((c) => c.name) };
}

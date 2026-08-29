import { eq } from "drizzle-orm";
import { anthropic, deployTarget } from "@/lib/anthropic";
import { db, schema } from "@/lib/db";
import { APP } from "@/lib/distill/stack";
import { runDistillTool } from "@/lib/distill/tools";
import { listAllEvents, unansweredToolUses } from "@/lib/smoke/ping-pong";

export type DistillSettle =
  | { action: "skipped"; reason: "not-ours" | "other-target" | "unknown-run" }
  | { action: "synced"; runId: string; status: RunStatus; tools: string[] };

type RunStatus = typeof schema.runs.$inferSelect["status"];

/**
 * Webhook entry point for distiller sessions — the single seam between CMA and
 * product state. Answers pending tool calls, then records the run's status and
 * cost so the mainline never has to ask CMA. Idempotent; safe to call on any
 * session.* event, in any order, any number of times.
 */
export async function settleDistillSession(sessionId: string): Promise<DistillSettle> {
  const session = await anthropic.beta.sessions.retrieve(sessionId);
  const m = session.metadata ?? {};
  if (m.app !== APP || !m.run_id) return { action: "skipped", reason: "not-ours" };
  if (m.target !== deployTarget()) return { action: "skipped", reason: "other-target" };

  const [run] = await db.select().from(schema.runs).where(eq(schema.runs.id, m.run_id));
  if (!run) return { action: "skipped", reason: "unknown-run" };

  const events = await listAllEvents(sessionId);
  const pending = unansweredToolUses(events);

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
  if (results.length > 0) await anthropic.beta.sessions.events.send(sessionId, { events: results });

  // Derive status from the resource, not from which webhook arrived.
  const idle = events.filter((e) => e.type === "session.status_idle").at(-1);
  const stop = idle?.type === "session.status_idle" ? idle.stop_reason.type : null;
  let status: RunStatus = "working";
  if (session.status === "terminated") status = "ended";
  else if (results.length > 0) status = "working"; // we just answered; the agent resumes
  else if (session.status === "idle" && stop === "budget_reached") status = "budget_reached";
  else if (session.status === "idle" && stop === "retries_exhausted") status = "ended";
  else if (session.status === "idle" && stop === "end_turn") status = "idle";

  await db
    .update(schema.runs)
    .set({ status, listCostCents: Number(session.usage.list_cost?.amount ?? 0), lastActivityAt: new Date() })
    .where(eq(schema.runs.id, run.id));
  return { action: "synced", runId: run.id, status, tools: pending.map((c) => c.name) };
}

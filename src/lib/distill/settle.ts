import { eq } from "drizzle-orm";

import { anthropic, deployTarget } from "@/lib/anthropic";
import { deriveRunStatus, type RunStatus } from "@/lib/cma/events";
import { answerPendingTools, listAllEvents } from "@/lib/cma/session";
import { db, schema } from "@/lib/db";
import { APP } from "@/lib/distill/stack";
import { runDistillTool } from "@/lib/distill/tools";

export type DistillSettle =
  | { action: "skipped"; reason: "not-ours" | "other-target" | "unknown-run" | "run-ended" | "session-terminal" }
  | { action: "synced"; runId: string; status: RunStatus; tools: string[] };

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
  // A late/reordered delivery for a run we already ended must not resurrect it.
  if (run.status === "ended") return { action: "skipped", reason: "run-ended" };
  // A terminated or archived session accepts no events; answering would 409.
  if (session.status === "terminated" || session.archived_at) {
    await db.update(schema.runs).set({ status: "ended", lastActivityAt: new Date() }).where(eq(schema.runs.id, run.id));
    return { action: "skipped", reason: "session-terminal" };
  }

  const events = await listAllEvents(sessionId);
  const ctx = { runId: run.id, subjectId: run.subjectId };
  const tools = await answerPendingTools(sessionId, events, (call) => runDistillTool({ ...ctx, toolUseId: call.id }, call.name, call.input));

  const status = deriveRunStatus(session.status, events, tools.length > 0);

  await db
    .update(schema.runs)
    .set({ status, listCostCents: Number(session.usage.list_cost?.amount ?? 0), lastActivityAt: new Date() })
    .where(eq(schema.runs.id, run.id));
  return { action: "synced", runId: run.id, status, tools };
}

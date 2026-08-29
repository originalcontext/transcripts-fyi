import { and, desc, eq, sql } from "drizzle-orm";
import { anthropic } from "@/lib/anthropic";
import { db, schema } from "@/lib/db";

export async function listUniverse() {
  // One row per subject with whether any artifact exists — drives the sidebar's greyed state.
  return db
    .select({
      id: schema.subjects.id,
      key: schema.subjects.key,
      displayName: schema.subjects.displayName,
      hasArtifact: sql<boolean>`exists (select 1 from ${schema.artifacts} a where a.subject_id = ${schema.subjects.id})`,
    })
    .from(schema.subjects)
    .orderBy(schema.subjects.key);
}

export async function getSubject(kind: string, key: string) {
  const [s] = await db
    .select()
    .from(schema.subjects)
    .where(and(eq(schema.subjects.kind, kind), eq(schema.subjects.key, key)));
  return s ?? null;
}

export async function latestArtifact(subjectId: string) {
  const [a] = await db
    .select()
    .from(schema.artifacts)
    .where(eq(schema.artifacts.subjectId, subjectId))
    .orderBy(desc(schema.artifacts.createdAt))
    .limit(1);
  return a ?? null;
}

export async function activeRun(subjectId: string, skill: string) {
  const [r] = await db
    .select()
    .from(schema.runs)
    .where(and(eq(schema.runs.subjectId, subjectId), eq(schema.runs.skill, skill), eq(schema.runs.status, "active")))
    .orderBy(desc(schema.runs.createdAt))
    .limit(1);
  return r ?? null;
}

/** "How the sausage was made": live from the CMA session, no DB copy. */
export async function sessionTrace(sessionId: string) {
  const [session, events] = await Promise.all([
    anthropic.beta.sessions.retrieve(sessionId),
    (async () => {
      const out = [];
      for await (const e of anthropic.beta.sessions.events.list(sessionId)) out.push(e);
      return out;
    })(),
  ]);
  const idle = events.filter((e) => e.type === "session.status_idle").at(-1);
  const stop = idle?.type === "session.status_idle" ? idle.stop_reason.type : null;
  const rows = events
    .filter((e) => !e.type.startsWith("span.") && e.type !== "agent.thinking")
    .map((e) => {
      let detail = "";
      if (e.type === "agent.custom_tool_use") detail = `${e.name} ${JSON.stringify(e.input).slice(0, 80)}`;
      else if (e.type === "agent.tool_use") detail = e.name;
      else if (e.type === "agent.message" || e.type === "user.message")
        detail = e.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(" ").slice(0, 120);
      else if (e.type === "user.custom_tool_result")
        detail = `${e.is_error ? "error " : ""}${(e.content ?? []).flatMap((b) => (b.type === "text" ? [b.text.length] : [])).join("")} chars`;
      else if (e.type === "session.status_idle") detail = e.stop_reason.type;
      else if (e.type === "session.error") detail = JSON.stringify(e.error).slice(0, 120);
      return { id: e.id, type: e.type, at: e.processed_at, detail };
    });
  return {
    status: session.status,
    stop,
    listCostCents: Number(session.usage.list_cost?.amount ?? 0),
    budgetCents: Number(session.budget?.max_list_cost.amount ?? 0),
    inputTokens: session.usage.input_tokens,
    outputTokens: session.usage.output_tokens,
    events: rows.slice(-60),
    traceUrl: `https://platform.claude.com/workspaces/default/sessions/${sessionId}`,
  };
}

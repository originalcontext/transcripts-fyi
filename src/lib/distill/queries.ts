import { and, desc, eq, ne, sql } from "drizzle-orm";

import { anthropic } from "@/lib/anthropic";
import { latestStopReason } from "@/lib/cma/events";
import { db, schema } from "@/lib/db";

export async function listUniverse() {
  // One row per subject with whether any artifact exists — drives the sidebar's greyed state.
  return db
    .select({
      id: schema.subjects.id,
      key: schema.subjects.key,
      displayName: schema.subjects.displayName,
      hasArtifact: sql<boolean>`exists (select 1 from ${schema.artifacts} a where a.subject_id = ${schema.subjects}.id)`,
      working: sql<boolean>`exists (select 1 from ${schema.runs} r where r.subject_id = ${schema.subjects}.id and r.status = 'working')`,
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

/** Sidebar/redirect helper: the first subject key, or null. */
export async function firstSubjectKey() {
  const [s] = await db.select({ key: schema.subjects.key }).from(schema.subjects).orderBy(schema.subjects.key).limit(1);
  return s?.key ?? null;
}

const subjectIdFor = (kind: string, key: string) =>
  db.select({ id: schema.subjects.id }).from(schema.subjects).where(and(eq(schema.subjects.kind, kind), eq(schema.subjects.key, key)));

/** Latest artifact for a subject addressed by (kind, key) — no prior lookup round. */
export async function latestArtifactFor(kind: string, key: string) {
  const [a] = await db
    .select()
    .from(schema.artifacts)
    .where(eq(schema.artifacts.subjectId, subjectIdFor(kind, key)))
    .orderBy(desc(schema.artifacts.createdAt))
    .limit(1);
  return a ?? null;
}

/** Live run for a subject addressed by (kind, key). */
export async function activeRunFor(kind: string, key: string, skill: string) {
  const [r] = await db
    .select()
    .from(schema.runs)
    .where(and(eq(schema.runs.subjectId, subjectIdFor(kind, key)), eq(schema.runs.skill, skill), ne(schema.runs.status, "ended")))
    .orderBy(desc(schema.runs.createdAt))
    .limit(1);
  return r ?? null;
}

export async function activeRun(subjectId: string, skill: string) {
  const [r] = await db
    .select()
    .from(schema.runs)
    .where(and(eq(schema.runs.subjectId, subjectId), eq(schema.runs.skill, skill), ne(schema.runs.status, "ended")))
    .orderBy(desc(schema.runs.createdAt))
    .limit(1);
  return r ?? null;
}

/** "How the sausage was made": live from the CMA session. Admin-only, fetched client-side, never on the render path. */
export async function sessionTrace(sessionId: string) {
  const [session, events] = await Promise.all([
    anthropic.beta.sessions.retrieve(sessionId),
    (async () => {
      const out = [];
      for await (const e of anthropic.beta.sessions.events.list(sessionId)) out.push(e);
      return out;
    })(),
  ]);
  const stop = latestStopReason(events);
  const t0 = Date.parse(session.created_at);
  const modelRequests = events.filter((e) => e.type === "span.model_request_end");
  const tokens = modelRequests.reduce(
    (acc, e) => {
      if (e.type !== "span.model_request_end" || !e.model_usage) return acc;
      acc.in += e.model_usage.input_tokens ?? 0;
      acc.cacheRead += e.model_usage.cache_read_input_tokens ?? 0;
      acc.cacheWrite += e.model_usage.cache_creation_input_tokens ?? 0;
      acc.out += e.model_usage.output_tokens ?? 0;
      return acc;
    },
    { in: 0, cacheRead: 0, cacheWrite: 0, out: 0 },
  );
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
      const at = e.processed_at ? Date.parse(e.processed_at) : NaN;
      return { id: e.id, type: e.type, at: e.processed_at, elapsedS: Number.isNaN(at) ? null : (at - t0) / 1000, detail };
    });
  const last = events.map((e) => (e.processed_at ? Date.parse(e.processed_at) : 0)).reduce((a, b) => Math.max(a, b), t0);
  return {
    status: session.status,
    stop,
    listCostCents: Number(session.usage.list_cost?.amount ?? 0),
    budgetCents: Number(session.budget?.max_list_cost.amount ?? 0),
    wallS: (last - t0) / 1000,
    modelRequests: modelRequests.length,
    tokens,
    eventCount: events.length,
    events: rows.slice(-80),
    traceUrl: `https://platform.claude.com/workspaces/default/sessions/${sessionId}`,
  };
}

import { anthropic } from "@/lib/anthropic";
import { latestStopReason } from "@/lib/cma/events";
import { listAllEvents } from "@/lib/cma/session";
import type { schema } from "@/lib/db";

/** "How the sausage was made": live from the CMA session. Admin-only, fetched client-side, never on the render path. */
export async function sessionTrace(sessionId: string) {
  const [session, events] = await Promise.all([anthropic.beta.sessions.retrieve(sessionId), listAllEvents(sessionId)]);
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

/** What /api/runs/[id]/trace returns; the Sausage pane imports only this type. */
export type TraceResponse = {
  run: Pick<typeof schema.runs.$inferSelect, "id" | "cmaSessionId" | "cmaAgentId" | "cmaAgentVersion" | "cmaSkillVersion">;
  trace: Awaited<ReturnType<typeof sessionTrace>>;
};

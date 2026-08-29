import crypto from "node:crypto";
import { anthropic, type DeployTarget } from "@/lib/anthropic";
import { listAllEvents, PONG_TOOL, SMOKE_KIND } from "@/lib/smoke/ping-pong";

export async function startSmokeSession(opts: {
  target: DeployTarget;
  agentId: string;
  agentVersion: number;
  environmentId: string;
}) {
  const nonce = crypto.randomBytes(3).toString("hex");
  const session = await anthropic.beta.sessions.create({
    agent: { type: "agent", id: opts.agentId, version: opts.agentVersion },
    environment_id: opts.environmentId,
    title: `smoke ping-pong ${opts.target} ${nonce}`,
    metadata: { smoke: SMOKE_KIND, target: opts.target, nonce },
    budget: { type: "limit", max_list_cost: { amount: "100", currency: "USD" } }, // $1.00
    initial_events: [{ type: "user.message", content: [{ type: "text", text: `ping ${nonce}` }] }],
  });
  return { sessionId: session.id, nonce };
}

export type SmokeCheck = { label: string; ok: boolean };
export type SmokeInspection = {
  sessionId: string;
  status: string;
  /** stop_reason of the latest idle, if idle */
  stop: string | null;
  /** true once the run can no longer change */
  done: boolean;
  checks: SmokeCheck[];
  pass: boolean;
  listCostCents: number;
  finalText: string | null;
  traceUrl: string;
};

export async function inspectSmokeSession(sessionId: string): Promise<SmokeInspection> {
  const session = await anthropic.beta.sessions.retrieve(sessionId);
  const target = session.metadata?.target ?? "?";
  const nonce = session.metadata?.nonce ?? "?";
  const events = await listAllEvents(sessionId);

  const idle = events.filter((e) => e.type === "session.status_idle").at(-1);
  const stop =
    session.status === "idle" && idle?.type === "session.status_idle" ? idle.stop_reason.type : null;
  const done =
    session.status === "terminated" || (stop !== null && stop !== "requires_action");

  const toolUse = events.find((e) => e.type === "agent.custom_tool_use" && e.name === PONG_TOOL);
  const toolResult = events.find((e) => e.type === "user.custom_tool_result");
  const readSkill = events.some((e) => e.type === "agent.tool_use" && e.name === "read");
  const finalText =
    events
      .flatMap((e) => (e.type === "agent.message" ? e.content : []))
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .at(-1)
      ?.trim() ?? null;
  const resultText =
    toolResult?.type === "user.custom_tool_result"
      ? toolResult.content?.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("")
      : undefined;
  let handledBy: string | undefined;
  try {
    handledBy = resultText ? (JSON.parse(resultText) as { handled_by?: string }).handled_by : undefined;
  } catch {
    handledBy = undefined;
  }

  const checks: SmokeCheck[] = [
    { label: `turn ended normally (${stop ?? session.status})`, ok: stop === "end_turn" },
    { label: `agent read the skill (${readSkill ? "read seen" : "no read seen"})`, ok: readSkill },
    {
      label: "agent called pong with the nonce",
      ok:
        toolUse?.type === "agent.custom_tool_use" &&
        (toolUse.input as { nonce?: string }).nonce === nonce,
    },
    {
      label: `webhook answered from target=${target} (got ${handledBy ?? "nothing yet"})`,
      ok: handledBy === target,
    },
    {
      label: `final reply is "pong ${nonce} via ${target}" (got ${JSON.stringify(finalText)})`,
      ok: finalText === `pong ${nonce} via ${target}`,
    },
  ];

  return {
    sessionId,
    status: session.status,
    stop,
    done,
    checks,
    pass: done && checks.every((c) => c.ok),
    listCostCents: Number(session.usage.list_cost?.amount ?? 0),
    finalText,
    traceUrl: `https://platform.claude.com/workspaces/default/sessions/${sessionId}`,
  };
}

export async function listSmokeSessions(agentId: string, limit = 10) {
  const page = await anthropic.beta.sessions.list({ agent_id: agentId, include_archived: true });
  return page.data
    .filter((s) => s.metadata?.smoke === SMOKE_KIND)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, limit)
    .map((s) => ({
      id: s.id,
      title: s.title,
      status: s.status,
      created_at: s.created_at,
      archived: s.archived_at !== null,
      listCostCents: Number(s.usage.list_cost?.amount ?? 0),
    }));
}

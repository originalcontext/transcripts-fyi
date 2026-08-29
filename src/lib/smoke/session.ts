import crypto from "node:crypto";

import { anthropic, type DeployTarget } from "@/lib/anthropic";
import { listAllEvents, SMOKE_KIND } from "@/lib/smoke/ping-pong";
import { FETCH_TRANSCRIPT_TOOL, PONG_TOOL, RENDER_SUMMARY_TOOL } from "@/lib/smoke/tools";

const SMOKE_SYMBOL = "NVDA";

/** The whole task in one user message — no extra skill needed yet. */
function smokeMessage(nonce: string) {
  return `ping ${nonce}

After you have replied to the ping, continue with one more task:
1. Call ${FETCH_TRANSCRIPT_TOOL} with {"symbol": "${SMOKE_SYMBOL}"} to get the latest earnings-call transcript.
2. Write a summary in markdown: five bullets, one sentence each, covering headline results, guidance, and the most notable analyst question.
3. Call ${RENDER_SUMMARY_TOOL} once with the symbol, the fiscal period stated in the transcript, and your summary.
4. Then reply with exactly one line: done ${nonce}`;
}

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
    budget: { type: "limit", max_list_cost: { amount: "200", currency: "USD" } }, // $2.00
    initial_events: [{ type: "user.message", content: [{ type: "text", text: smokeMessage(nonce) }] }],
  });
  return { sessionId: session.id, nonce };
}

type SmokeCheck = { label: string; ok: boolean };
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
  summary: { symbol: string; period: string; summary: string } | null;
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

  const toolUses = events.filter((e) => e.type === "agent.custom_tool_use");
  const toolResults = events.filter((e) => e.type === "user.custom_tool_result");
  const inputOf = (name: string) =>
    toolUses.find((e) => e.name === name)?.input as Record<string, unknown> | undefined;
  const resultOf = (name: string) => {
    const use = toolUses.find((e) => e.name === name);
    const res = toolResults.find((r) => r.custom_tool_use_id === use?.id);
    const text = res?.content?.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    try {
      return text ? (JSON.parse(text) as Record<string, unknown>) : undefined;
    } catch {
      return undefined;
    }
  };

  const readSkill = events.some((e) => e.type === "agent.tool_use" && e.name === "read");
  const texts = events
    .flatMap((e) => (e.type === "agent.message" ? e.content : []))
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .map((t) => t.trim());
  const finalText = texts.at(-1) ?? null;

  const pongIn = inputOf(PONG_TOOL);
  const handledBy = resultOf(PONG_TOOL)?.handled_by;
  const pongLine = `pong ${nonce} via ${target}`;

  const fetchIn = inputOf(FETCH_TRANSCRIPT_TOOL);
  const fetched = resultOf(FETCH_TRANSCRIPT_TOOL);
  const transcriptChars = typeof fetched?.content === "string" ? fetched.content.length : 0;

  const renderIn = inputOf(RENDER_SUMMARY_TOOL);
  const summaryText = typeof renderIn?.summary === "string" ? renderIn.summary : "";
  const summary = summaryText
    ? { symbol: String(renderIn?.symbol ?? ""), period: String(renderIn?.period ?? ""), summary: summaryText }
    : null;

  const checks: SmokeCheck[] = [
    { label: `turn ended normally (${stop ?? session.status})`, ok: stop === "end_turn" },
    { label: `agent read the skill (${readSkill ? "read seen" : "no read seen"})`, ok: readSkill },
    { label: "agent called pong with the nonce", ok: pongIn?.nonce === nonce },
    { label: `webhook answered from target=${target} (got ${handledBy ?? "nothing yet"})`, ok: handledBy === target },
    { label: `agent replied "${pongLine}"`, ok: texts.some((t) => t.includes(pongLine)) },
    {
      label: `fetched ${SMOKE_SYMBOL} transcript (${transcriptChars ? `${transcriptChars} chars` : "nothing yet"})`,
      ok: fetchIn?.symbol === SMOKE_SYMBOL && transcriptChars > 1000,
    },
    {
      label: `rendered summary (${summaryText ? `${summaryText.length} chars, ${summary?.period}` : "nothing yet"})`,
      ok: summaryText.length > 100 && String(renderIn?.symbol ?? "").toUpperCase() === SMOKE_SYMBOL,
    },
    { label: `final reply is "done ${nonce}" (got ${JSON.stringify(finalText)})`, ok: finalText === `done ${nonce}` },
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
    summary,
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

/** Poll until the smoke run can no longer change. Used by the CLI; the page polls /api/smoke instead. */
export async function waitForSmokeSession(sessionId: string, opts: { timeoutMs?: number; pollMs?: number; onTick?: (i: SmokeInspection) => void } = {}) {
  const { timeoutMs = 4 * 60_000, pollMs = 2_000, onTick } = opts;
  const started = Date.now();
  for (;;) {
    if (Date.now() - started > timeoutMs) throw new Error(`timed out after ${timeoutMs / 1000}s`);
    await new Promise((r) => setTimeout(r, pollMs));
    const result = await inspectSmokeSession(sessionId);
    onTick?.(result);
    if (result.done) return { result, elapsedS: (Date.now() - started) / 1000 };
  }
}

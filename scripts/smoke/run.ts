/**
 * Data plane: run one ping-pong round trip and verify it.
 *
 *   npm run smoke:run -- --target dev    # local next dev + ngrok answers
 *   npm run smoke:run -- --target prod   # https://transcripts.fyi answers
 *
 * This script only OBSERVES. It never answers the tool call itself — that is
 * the webhook handler's job, which is the thing under test. Exit 0 on pass.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { anthropic } from "@/lib/anthropic";
import { listAllEvents, PONG_TOOL, SMOKE_KIND } from "@/lib/smoke/ping-pong";
import type { SmokeState } from "./setup";

const ROOT = path.resolve(import.meta.dirname, "../..");
const TIMEOUT_MS = 4 * 60_000;
const POLL_MS = 2_000;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const target = arg("target");
  if (target !== "dev" && target !== "prod") throw new Error("--target dev|prod is required");
  const state: SmokeState = JSON.parse(fs.readFileSync(path.join(ROOT, ".smoke.json"), "utf8"));
  const nonce = crypto.randomBytes(3).toString("hex");

  const session = await anthropic.beta.sessions.create({
    agent: { type: "agent", id: state.agent_id, version: state.agent_version },
    environment_id: state.environment_id,
    title: `smoke ping-pong ${target} ${nonce}`,
    metadata: { smoke: SMOKE_KIND, target, nonce },
    budget: { type: "limit", max_list_cost: { amount: "100", currency: "USD" } }, // $1.00
    initial_events: [{ type: "user.message", content: [{ type: "text", text: `ping ${nonce}` }] }],
  });
  console.log(`session ${session.id}  target=${target}  nonce=${nonce}  status=${session.status}`);
  console.log(`trace   https://platform.claude.com/workspaces/default/sessions/${session.id}`);

  // Poll until the turn really ends. `requires_action` idles are the webhook's
  // cue, not ours — keep waiting through them.
  const started = Date.now();
  let stop: string | undefined;
  for (;;) {
    if (Date.now() - started > TIMEOUT_MS) throw new Error(`timed out after ${TIMEOUT_MS / 1000}s`);
    await new Promise((r) => setTimeout(r, POLL_MS));
    const s = await anthropic.beta.sessions.retrieve(session.id);
    if (s.status === "terminated") { stop = "terminated"; break; }
    if (s.status !== "idle") { process.stdout.write("."); continue; }
    const idle = (await listAllEvents(session.id)).filter((e) => e.type === "session.status_idle").at(-1);
    const reason = idle?.type === "session.status_idle" ? idle.stop_reason.type : undefined;
    process.stdout.write(reason === "requires_action" ? "?" : "!");
    if (reason && reason !== "requires_action") { stop = reason; break; }
  }
  console.log(`\nstopped: ${stop}  after ${((Date.now() - started) / 1000).toFixed(1)}s`);

  // Verify from the event log.
  const events = await listAllEvents(session.id);
  const toolUse = events.find((e) => e.type === "agent.custom_tool_use" && e.name === PONG_TOOL);
  const toolResult = events.find((e) => e.type === "user.custom_tool_result");
  const readSkill = events.some((e) => e.type === "agent.tool_use" && e.name === "read");
  const finalText = events
    .flatMap((e) => (e.type === "agent.message" ? e.content : []))
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .at(-1)
    ?.trim();
  const resultText =
    toolResult?.type === "user.custom_tool_result"
      ? toolResult.content?.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("")
      : undefined;
  const handledBy = resultText ? (JSON.parse(resultText) as { handled_by?: string }).handled_by : undefined;

  const checks: [string, boolean][] = [
    ["turn ended normally (end_turn)", stop === "end_turn"],
    [`agent read the skill (${readSkill ? "read tool seen" : "no read seen"})`, readSkill],
    ["agent called pong with the nonce", toolUse?.type === "agent.custom_tool_use" && (toolUse.input as { nonce?: string }).nonce === nonce],
    [`webhook answered from target=${target} (got ${handledBy ?? "nothing"})`, handledBy === target],
    [`final reply is "pong ${nonce} via ${target}" (got ${JSON.stringify(finalText)})`, finalText === `pong ${nonce} via ${target}`],
  ];
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);

  const final = await anthropic.beta.sessions.retrieve(session.id);
  const cents = Number(final.usage.list_cost?.amount ?? 0);
  console.log(`cost    $${(cents / 100).toFixed(2)} list  tokens in/out ${final.usage.input_tokens}/${final.usage.output_tokens}`);

  // Sessions are disposable; archive (after the post-idle status-write race settles).
  for (let i = 0; i < 10 && (await anthropic.beta.sessions.retrieve(session.id)).status === "running"; i++)
    await new Promise((r) => setTimeout(r, 200));
  await anthropic.beta.sessions.archive(session.id);

  process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

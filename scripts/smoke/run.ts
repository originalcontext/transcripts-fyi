/**
 * CLI twin of the "Run smoke" button. Ensures the stack, starts one session,
 * polls until done, prints checks. Exit 0 on pass.
 *
 *   npm run smoke:run -- --target dev|prod
 *
 * Observes only — the webhook handler answers the tool call.
 */
import { startSmokeSession, waitForSmokeSession } from "@/lib/smoke/session";
import { ensureSmokeStack } from "@/lib/smoke/stack";

async function main() {
  const i = process.argv.indexOf("--target");
  const target = i === -1 ? undefined : process.argv[i + 1];
  if (target !== "dev" && target !== "prod") throw new Error("--target dev|prod is required");

  const stack = await ensureSmokeStack(target);
  console.log(`stack   env=${stack.environment.id} skill=${stack.skill.id} agent=${stack.agent.id} v${stack.agent.version}`);

  const { sessionId, nonce } = await startSmokeSession({
    target,
    agentId: stack.agent.id,
    agentVersion: stack.agent.version,
    environmentId: stack.environment.id,
  });
  console.log(`session ${sessionId}  target=${target}  nonce=${nonce}`);

  const { result, elapsedS } = await waitForSmokeSession(sessionId, {
    onTick: (r) => process.stdout.write(r.stop === "requires_action" ? "?" : r.status === "idle" ? "!" : "."),
  });
  console.log(`\nstopped: ${result.stop ?? result.status}  after ${elapsedS.toFixed(1)}s`);
  for (const c of result.checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.label}`);
  if (result.summary) console.log(`\n--- ${result.summary.symbol} · ${result.summary.period} ---\n${result.summary.summary}\n`);
  console.log(`cost    $${(result.listCostCents / 100).toFixed(2)} list`);
  console.log(`trace   ${result.traceUrl}`);
  process.exit(result.pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

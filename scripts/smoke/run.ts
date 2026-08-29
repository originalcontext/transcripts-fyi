/**
 * CLI twin of the "Run smoke" button. Ensures the stack, starts one session,
 * polls until done, prints checks. Exit 0 on pass.
 *
 *   npm run smoke:run -- --target dev|prod
 *
 * Observes only — the webhook handler answers the tool call.
 */
import { ensureStack } from "@/lib/smoke/stack";
import { inspectSmokeSession, startSmokeSession } from "@/lib/smoke/session";

const TIMEOUT_MS = 4 * 60_000;
const POLL_MS = 2_000;

async function main() {
  const i = process.argv.indexOf("--target");
  const target = i === -1 ? undefined : process.argv[i + 1];
  if (target !== "dev" && target !== "prod") throw new Error("--target dev|prod is required");

  const stack = await ensureStack(target);
  console.log(`stack   env=${stack.environment!.id} skill=${stack.skill!.id} agent=${stack.agent!.id} v${stack.agent!.version}`);

  const { sessionId, nonce } = await startSmokeSession({
    target,
    agentId: stack.agent!.id,
    agentVersion: stack.agent!.version,
    environmentId: stack.environment!.id,
  });
  console.log(`session ${sessionId}  target=${target}  nonce=${nonce}`);

  const started = Date.now();
  let result;
  for (;;) {
    if (Date.now() - started > TIMEOUT_MS) throw new Error(`timed out after ${TIMEOUT_MS / 1000}s`);
    await new Promise((r) => setTimeout(r, POLL_MS));
    result = await inspectSmokeSession(sessionId);
    process.stdout.write(result.stop === "requires_action" ? "?" : result.status === "idle" ? "!" : ".");
    if (result.done) break;
  }
  console.log(`\nstopped: ${result.stop ?? result.status}  after ${((Date.now() - started) / 1000).toFixed(1)}s`);
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

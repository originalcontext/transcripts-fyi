/**
 * Reconciler — DRY RUN. Prints what a cron reconciler would change; changes nothing.
 *   npm run reconcile
 *
 * Checks, read-only against Postgres and CMA:
 *   1. status drift   runs.status ≠ what the session resource says now
 *   2. stuck          session idle on requires_action with unanswered custom tool calls
 *   3. orphans        CMA sessions tagged app=tfyi/target with no runs row
 *   4. stale working  runs "working" with no activity for > STALE_MIN
 */
import { ne } from "drizzle-orm";

import { anthropic, deployTarget } from "@/lib/anthropic";
import { deriveRunStatus, unansweredToolUses } from "@/lib/cma/events";
import { db, schema } from "@/lib/db";
import { APP } from "@/lib/distill/stack";
import { listAllEvents } from "@/lib/smoke/ping-pong";

const STALE_MIN = 20;
const target = deployTarget();

async function main() {
  const runs = await db.select().from(schema.runs).where(ne(schema.runs.status, "ended"));
  console.log(`target=${target}  live runs=${runs.length}\n`);
  let findings = 0;
  const knownSessions = new Set<string>();

  for (const run of runs) {
    knownSessions.add(run.cmaSessionId);
    let session;
    try {
      session = await anthropic.beta.sessions.retrieve(run.cmaSessionId);
    } catch (err) {
      findings++;
      console.log(`[missing]  run ${run.id.slice(0, 8)} session ${run.cmaSessionId}: ${err instanceof Error ? err.message : err}`);
      continue;
    }
    const events = await listAllEvents(run.cmaSessionId);
    const derived = deriveRunStatus(session.status, events);
    const pending = unansweredToolUses(events);
    const ageMin = (Date.now() - run.lastActivityAt.getTime()) / 60_000;

    if (derived !== run.status) {
      findings++;
      console.log(`[drift]    run ${run.id.slice(0, 8)} ${run.status} → ${derived}  (session ${session.status})  would: update runs.status`);
    }
    if (session.status === "idle" && pending.length > 0) {
      findings++;
      console.log(`[stuck]    run ${run.id.slice(0, 8)} idle with ${pending.length} unanswered: ${pending.map((p) => p.name).join(",")}  would: settle`);
    }
    if (run.status === "working" && ageMin > STALE_MIN) {
      findings++;
      console.log(`[stale]    run ${run.id.slice(0, 8)} working for ${ageMin.toFixed(0)}m (session ${session.status})  would: re-settle, alert if still working`);
    }
  }

  // All non-archived sessions in this workspace with our tag, minus known → orphans.
  for await (const s of anthropic.beta.sessions.list()) {
    const m = s.metadata ?? {};
    if (m.app !== APP || m.target !== target || s.archived_at || knownSessions.has(s.id)) continue;
    findings++;
    console.log(`[orphan]   session ${s.id} (${s.status}, run_id=${m.run_id ?? "-"}, ${s.title ?? ""})  would: archive`);
  }

  console.log(`\n${findings} finding(s). Nothing changed.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

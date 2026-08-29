/**
 * Reconciler CLI.  npm run reconcile            # dry run, prints findings
 *                  npm run reconcile -- --apply # same repairs the cron makes
 * The cron at /api/cron/reconcile runs reconcile({ apply: true }) every 5 minutes.
 */
import { reconcile } from "@/lib/ops/reconcile";

reconcile({ apply: process.argv.includes("--apply") }).then((r) => {
  console.log(`target=${r.target}  live runs=${r.liveRuns}\n`);
  for (const f of r.findings) console.log(`[${f.kind.padEnd(7)}]`, JSON.stringify(f));
  for (const a of r.applied) console.log("applied:", a);
  console.log(`\n${r.findings.length} finding(s)${r.applied.length ? `, ${r.applied.length} applied` : ", nothing changed"}.`);
  process.exit(0);
});

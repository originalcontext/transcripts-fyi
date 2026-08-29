import { and, eq, lt } from "drizzle-orm";

import { anthropic } from "@/lib/anthropic";
import { db, schema } from "@/lib/db";

/**
 * Garbage collection. Sessions of ended runs get archived after a grace
 * period (the trace pane can still read archived sessions); webhook dedupe
 * rows expire well after Anthropic's last possible retry.
 */

const ENDED_GRACE_DAYS = 7;
const WEBHOOK_EVENT_TTL_DAYS = 30;

export type GcReport = { archivedSessions: string[]; prunedWebhookEvents: number; skipped: string[] };

export async function gc(opts: { apply?: boolean } = {}): Promise<GcReport> {
  const apply = opts.apply ?? false;
  const report: GcReport = { archivedSessions: [], prunedWebhookEvents: 0, skipped: [] };

  const cutoff = new Date(Date.now() - ENDED_GRACE_DAYS * 86_400_000);
  const ended = await db
    .select()
    .from(schema.runs)
    .where(and(eq(schema.runs.status, "ended"), lt(schema.runs.lastActivityAt, cutoff)));
  for (const run of ended) {
    try {
      const s = await anthropic.beta.sessions.retrieve(run.cmaSessionId);
      if (s.archived_at) continue;
      if (s.status === "running") {
        report.skipped.push(`${run.cmaSessionId} still running`);
        continue;
      }
      if (apply) await anthropic.beta.sessions.archive(run.cmaSessionId);
      report.archivedSessions.push(run.cmaSessionId);
    } catch (err) {
      report.skipped.push(`${run.cmaSessionId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const ttl = new Date(Date.now() - WEBHOOK_EVENT_TTL_DAYS * 86_400_000);
  if (apply) {
    const deleted = await db.delete(schema.webhookEvents).where(lt(schema.webhookEvents.receivedAt, ttl)).returning({ id: schema.webhookEvents.id });
    report.prunedWebhookEvents = deleted.length;
  } else {
    const [{ n }] = await db
      .select({ n: schema.webhookEvents.id })
      .from(schema.webhookEvents)
      .where(lt(schema.webhookEvents.receivedAt, ttl))
      .then((rows) => [{ n: rows.length }]);
    report.prunedWebhookEvents = n;
  }
  return report;
}

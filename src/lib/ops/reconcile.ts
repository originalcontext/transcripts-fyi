import { eq, ne } from "drizzle-orm";

import { anthropic, deployTarget } from "@/lib/anthropic";
import { deriveRunStatus, unansweredToolUses } from "@/lib/cma/events";
import { db, schema } from "@/lib/db";
import { settleDistillSession } from "@/lib/distill/settle";
import { APP } from "@/lib/distill/stack";
import { listAllEvents } from "@/lib/smoke/ping-pong";

/**
 * Reconciler — belt and suspenders under the webhook.
 *
 * Webhooks are the fast path; Anthropic retries three times with jittered
 * backoff (5–120s) and then drops the event. This pass re-derives every live
 * run from the session resource and repairs what a dropped delivery would
 * have left behind. Every repair is the same idempotent settle the webhook
 * runs, so running this too often is merely wasteful, never harmful.
 *
 * `apply: false` (default) only reports.
 */

type Finding =
  | { kind: "drift"; runId: string; from: string; to: string }
  | { kind: "stuck"; runId: string; pending: string[] }
  | { kind: "stale"; runId: string; minutes: number; sessionStatus: string }
  | { kind: "missing"; runId: string; sessionId: string; error: string }
  | { kind: "orphan"; sessionId: string; status: string; ageMinutes: number };

export type ReconcileReport = { target: string; liveRuns: number; findings: Finding[]; applied: string[] };

const STALE_MIN = 20;
const ORPHAN_MIN_AGE_MIN = 60; // an orphan younger than this may be a run insert still in flight

export async function reconcile(opts: { apply?: boolean } = {}): Promise<ReconcileReport> {
  const apply = opts.apply ?? false;
  const target = deployTarget();
  const findings: Finding[] = [];
  const applied: string[] = [];
  const runs = await db.select().from(schema.runs).where(ne(schema.runs.status, "ended"));
  const known = new Set<string>();

  for (const run of runs) {
    known.add(run.cmaSessionId);
    let session;
    try {
      session = await anthropic.beta.sessions.retrieve(run.cmaSessionId);
    } catch (err) {
      findings.push({ kind: "missing", runId: run.id, sessionId: run.cmaSessionId, error: err instanceof Error ? err.message : String(err) });
      if (apply) {
        await db.update(schema.runs).set({ status: "ended", lastActivityAt: new Date() }).where(eq(schema.runs.id, run.id));
        applied.push(`ended run ${run.id} (session missing)`);
      }
      continue;
    }
    const events = await listAllEvents(run.cmaSessionId);
    const derived = deriveRunStatus(session.status, events);
    const pending = unansweredToolUses(events);
    const minutes = (Date.now() - run.lastActivityAt.getTime()) / 60_000;

    let needsSettle = false;
    if (derived !== run.status) {
      findings.push({ kind: "drift", runId: run.id, from: run.status, to: derived });
      needsSettle = true;
    }
    if (session.status === "idle" && pending.length > 0) {
      findings.push({ kind: "stuck", runId: run.id, pending: pending.map((p) => p.name) });
      needsSettle = true;
    }
    if (run.status === "working" && minutes > STALE_MIN) {
      findings.push({ kind: "stale", runId: run.id, minutes: Math.round(minutes), sessionStatus: session.status });
      needsSettle = true;
    }
    if (apply && needsSettle) {
      const r = await settleDistillSession(run.cmaSessionId);
      applied.push(`settled run ${run.id}: ${JSON.stringify(r)}`);
    }
  }

  for await (const s of anthropic.beta.sessions.list()) {
    const m = s.metadata ?? {};
    if (m.app !== APP || m.target !== target || s.archived_at || known.has(s.id)) continue;
    const ageMinutes = (Date.now() - Date.parse(s.created_at)) / 60_000;
    findings.push({ kind: "orphan", sessionId: s.id, status: s.status, ageMinutes: Math.round(ageMinutes) });
    if (apply && ageMinutes > ORPHAN_MIN_AGE_MIN && s.status !== "running") {
      await anthropic.beta.sessions.archive(s.id);
      applied.push(`archived orphan ${s.id}`);
    }
  }

  return { target, liveRuns: runs.length, findings, applied };
}

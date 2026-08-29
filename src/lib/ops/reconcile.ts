import { asc, eq, ne } from "drizzle-orm";

import { anthropic, deployTarget } from "@/lib/anthropic";
import { isNotFound } from "@/lib/cma/errors";
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
  | { kind: "hung"; runId: string; quietMinutes: number; nudges: number; action: "interrupt" | "continue" | "give-up" }
  | { kind: "error"; runId: string; error: string }
  | { kind: "missing"; runId: string; sessionId: string; error: string }
  | { kind: "unreachable"; runId: string; sessionId: string; error: string }
  | { kind: "orphan"; sessionId: string; status: string; ageMinutes: number }
  | { kind: "deferred"; remaining: number };

export type ReconcileReport = { target: string; liveRuns: number; findings: Finding[]; applied: string[] };

const PASS_BUDGET_MS = 45_000; // under the route's maxDuration; whatever is left waits for the next pass
const PASS_CAP = 40; // runs per pass, oldest activity first
const QUIET_RUNNING_MIN = 20; // no session event for this long while "running" = hung (a healthy run emits events every minute)
const QUIET_STUCK_MIN = 2; // don't race an in-flight webhook on a just-idled session
const MAX_NUDGES = 2; // interrupt, then "continue from notes", then give up
const ORPHAN_MIN_AGE_MIN = 60; // an orphan younger than this may be a run insert still in flight

export async function reconcile(opts: { apply?: boolean } = {}): Promise<ReconcileReport> {
  const apply = opts.apply ?? false;
  const target = deployTarget();
  const findings: Finding[] = [];
  const applied: string[] = [];
  const runs = await db.select().from(schema.runs).where(ne(schema.runs.status, "ended")).orderBy(asc(schema.runs.lastActivityAt));
  const known = new Set(runs.map((r) => r.cmaSessionId));
  const started = Date.now();
  let visited = 0;

  for (const run of runs.slice(0, PASS_CAP)) {
    if (Date.now() - started > PASS_BUDGET_MS) break;
    visited++;
    try {
      await reconcileRun(run, { apply, findings, applied });
    } catch (err) {
      // One bad run must not abort the pass for the others.
      findings.push({ kind: "error", runId: run.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (visited < runs.length) findings.push({ kind: "deferred", remaining: runs.length - visited });

  for await (const s of anthropic.beta.sessions.list()) {
    if (Date.now() - started > PASS_BUDGET_MS) break;
    const m = s.metadata ?? {};
    if (m.app !== APP || m.target !== target || s.archived_at || known.has(s.id)) continue;
    const ageMinutes = (Date.now() - Date.parse(s.created_at)) / 60_000;
    findings.push({ kind: "orphan", sessionId: s.id, status: s.status, ageMinutes: Math.round(ageMinutes) });
    if (!apply || ageMinutes <= ORPHAN_MIN_AGE_MIN) continue;
    if (s.status === "running") {
      await anthropic.beta.sessions.events.send(s.id, { events: [{ type: "user.interrupt" }] }).catch(() => {});
      applied.push(`interrupted running orphan ${s.id} (archive next pass)`);
    } else {
      await anthropic.beta.sessions.archive(s.id);
      applied.push(`archived orphan ${s.id}`);
    }
  }

  return { target, liveRuns: runs.length, findings, applied };
}

type Ctx = { apply: boolean; findings: Finding[]; applied: string[] };
type Run = typeof schema.runs.$inferSelect;

/** Minutes since the last session event was processed (the session's own clock, not ours). */
function quietMinutes(events: Awaited<ReturnType<typeof listAllEvents>>, createdAt: string) {
  const last = events.reduce((m, e) => Math.max(m, e.processed_at ? Date.parse(e.processed_at) : 0), Date.parse(createdAt));
  return (Date.now() - last) / 60_000;
}

async function reconcileRun(run: Run, { apply, findings, applied }: Ctx) {
  let session;
  try {
    session = await anthropic.beta.sessions.retrieve(run.cmaSessionId);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    // Only a 404 means the session is gone. A 429/5xx/network error means
    // CMA is unreachable right now — leave the run alone and try next pass.
    if (!isNotFound(err)) {
      findings.push({ kind: "unreachable", runId: run.id, sessionId: run.cmaSessionId, error });
      return;
    }
    findings.push({ kind: "missing", runId: run.id, sessionId: run.cmaSessionId, error });
    if (apply) {
      await db.update(schema.runs).set({ status: "ended", lastActivityAt: new Date() }).where(eq(schema.runs.id, run.id));
      applied.push(`ended run ${run.id} (session missing)`);
    }
    return;
  }

  const events = await listAllEvents(run.cmaSessionId);
  const derived = deriveRunStatus(session.status, events);
  const pending = unansweredToolUses(events);
  const quiet = quietMinutes(events, session.created_at);
  let needsSettle = false;

  if (derived !== run.status) {
    findings.push({ kind: "drift", runId: run.id, from: run.status, to: derived });
    needsSettle = true;
  }
  if (session.status === "idle" && pending.length > 0 && quiet > QUIET_STUCK_MIN) {
    findings.push({ kind: "stuck", runId: run.id, pending: pending.map((p) => p.name) });
    needsSettle = true;
  }
  if (apply && needsSettle) {
    const r = await settleDistillSession(run.cmaSessionId);
    applied.push(`settled run ${run.id}: ${JSON.stringify(r)}`);
  }

  // Hung: "running" but the session has emitted nothing for a long time.
  if (session.status === "running" && quiet > QUIET_RUNNING_MIN) {
    const nudges = Number(session.metadata?.nudges ?? 0);
    const action = nudges === 0 ? "interrupt" : nudges < MAX_NUDGES ? "continue" : "give-up";
    findings.push({ kind: "hung", runId: run.id, quietMinutes: Math.round(quiet), nudges, action });
    if (!apply) return;
    if (action === "give-up") {
      await anthropic.beta.sessions.events.send(run.cmaSessionId, { events: [{ type: "user.interrupt" }] }).catch(() => {});
      await db.update(schema.runs).set({ status: "ended", lastActivityAt: new Date() }).where(eq(schema.runs.id, run.id));
      applied.push(`gave up on hung run ${run.id} after ${nudges} nudges`);
      return;
    }
    await anthropic.beta.sessions.events.send(run.cmaSessionId, {
      events:
        action === "interrupt"
          ? [{ type: "user.interrupt" }]
          : [{ type: "user.message", content: [{ type: "text", text: "You stopped responding. Continue from your notes in /workspace/notes and finish the explainer; if you cannot, post what you have." }] }],
    });
    await anthropic.beta.sessions.update(run.cmaSessionId, { metadata: { ...(session.metadata ?? {}), nudges: String(nudges + 1) } });
    applied.push(`nudged hung run ${run.id}: ${action}`);
  }
}

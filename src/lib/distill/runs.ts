import crypto from "node:crypto";

import { NeonDbError } from "@neondatabase/serverless";
import { and, count, eq, ne } from "drizzle-orm";

import { anthropic, type DeployTarget } from "@/lib/anthropic";
import { isNotFound } from "@/lib/cma/errors";
import { forgetStack } from "@/lib/cma/stack";
import { db, schema } from "@/lib/db";
import { activeRun, getSubject } from "@/lib/distill/queries";
import { DISTILL_SKILL } from "@/lib/distill/skill";
import { APP, distillSpec, ensureDistillStack } from "@/lib/distill/stack";
import { errorMessage,UserError } from "@/lib/errors";

const RUN_BUDGET_CENTS = 2500; // $25 per run (20 quarters; NVDA measured ~$9.50)
const MAX_SUBJECTS = 100; // shared universe, trusted invitees — a ceiling, not a quota
const MAX_REGENERATIONS = 10; // per subject, beyond the first run
const BUMP_CENTS = 500;

const isUniqueViolation = (err: unknown) => err instanceof NeonDbError && err.code === "23505";

/** The one way a run stops being live. */
export async function endRun(runId: string) {
  await db.update(schema.runs).set({ status: "ended", lastActivityAt: new Date() }).where(eq(schema.runs.id, runId));
}

/** Raise a run's spend cap by $5 above the higher of the current cap and consumed cost. */
export async function bumpRunBudget(runId: string) {
  const [run] = await db.select().from(schema.runs).where(eq(schema.runs.id, runId));
  if (!run) throw new UserError("That run no longer exists.");
  const s = await anthropic.beta.sessions.retrieve(run.cmaSessionId);
  const consumed = Number(s.usage.list_cost?.amount ?? 0);
  const current = Number(s.budget?.max_list_cost.amount ?? 0);
  const next = Math.max(current, consumed + 1) + BUMP_CENTS;
  await anthropic.beta.sessions.update(run.cmaSessionId, { budget: { type: "limit", max_list_cost: { amount: String(next), currency: "USD" } } });
  return next;
}

type Subject = typeof schema.subjects.$inferSelect;

/** Start a fresh distillation run on the current stack (skill + agent at "latest"). */
async function startRun(subject: Subject, target: DeployTarget) {
  const key = subject.key;
  let stack = await ensureDistillStack(target);
  const runId = crypto.randomUUID();
  // Create the session IDLE (no initial_events): nothing spends until we have
  // durably recorded the run. The kick is sent last.
  const create = () =>
    anthropic.beta.sessions.create({
      agent: { type: "agent", id: stack.agentId, version: stack.agentVersion },
      environment_id: stack.environmentId,
      title: `${key} · ${DISTILL_SKILL} · ${target}`,
      metadata: { app: APP, target, run_id: runId, subject: key, skill: DISTILL_SKILL },
      budget: { type: "limit", max_list_cost: { amount: String(RUN_BUDGET_CENTS), currency: "USD" } },
    });
  // If the remembered ids are stale (agent/environment archived out of band), forget and resolve once.
  const session = await create().catch(async (err: unknown) => {
    if (!isNotFound(err)) throw err;
    await forgetStack(distillSpec(target));
    stack = await ensureDistillStack(target);
    return create();
  });
  // A concurrent add/regenerate loses the race here (partial unique index on live runs).
  try {
    await db.insert(schema.runs).values({
    id: runId,
    subjectId: subject.id,
    skill: DISTILL_SKILL,
    target,
    cmaSessionId: session.id,
    cmaAgentId: stack.agentId,
    cmaAgentVersion: stack.agentVersion,
    cmaEnvironmentId: stack.environmentId,
    cmaSkillVersion: stack.skillVersion,
    });
  } catch (err) {
    await anthropic.beta.sessions.archive(session.id).catch(() => {}); // idle session, nothing spent
    if (isUniqueViolation(err)) throw new UserError(`${key} is already being distilled.`);
    throw err;
  }
  await anthropic.beta.sessions.events.send(session.id, {
    events: [{ type: "user.message", content: [{ type: "text", text: `Distill ${key} using the ${DISTILL_SKILL} skill.` }] }],
  });
  return runId;
}

/** Archive 400s on a running session: interrupt first and wait (briefly) for idle. */
async function settleForArchive(sessionId: string) {
  const s = await anthropic.beta.sessions.retrieve(sessionId).catch(() => null);
  if (!s || s.status !== "running") return;
  await anthropic.beta.sessions.events.send(sessionId, { events: [{ type: "user.interrupt" }] }).catch(() => {});
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const now = await anthropic.beta.sessions.retrieve(sessionId).catch(() => null);
    if (now && now.status !== "running") return;
  }
}

/** End the subject's live runs (archive their sessions) and start a fresh one. Artifacts are kept. */
export async function regenerateSubject(subjectId: string, target: DeployTarget) {
  const [subject] = await db.select().from(schema.subjects).where(eq(schema.subjects.id, subjectId));
  if (!subject) throw new Error("no such subject");
  const [{ n: priorRuns }] = await db.select({ n: count() }).from(schema.runs).where(eq(schema.runs.subjectId, subjectId));
  if (priorRuns - 1 >= MAX_REGENERATIONS)
    throw new UserError(`${subject.key} has been regenerated ${MAX_REGENERATIONS} times — that's the limit for now.`);
  const live = await db
    .select()
    .from(schema.runs)
    .where(and(eq(schema.runs.subjectId, subjectId), eq(schema.runs.skill, DISTILL_SKILL), ne(schema.runs.status, "ended")));
  for (const r of live) {
    await settleForArchive(r.cmaSessionId);
    // If the old session cannot be archived, stop: marking it ended would leave it spending unseen.
    await anthropic.beta.sessions.archive(r.cmaSessionId).catch((err: unknown) => {
      if (isNotFound(err) || /archived|terminated/i.test(err instanceof Error ? err.message : "")) return;
      throw new UserError(`Could not archive the current run (${errorMessage(err)}). Try again in a minute.`);
    });
    await endRun(r.id);
  }
  return startRun(subject, target);
}

/** Add a ticker to the universe and start its distillation run if none is active. */
export async function addSubject(key: string, target: DeployTarget) {
  let subject = await getSubject("ticker", key);
  if (!subject) {
    const [{ n }] = await db.select({ n: count() }).from(schema.subjects);
    if (n >= MAX_SUBJECTS) throw new UserError(`The universe is full (${MAX_SUBJECTS} companies).`);
    const [inserted] = await db
      .insert(schema.subjects)
      .values({ id: crypto.randomUUID(), kind: "ticker", key, displayName: key })
      .onConflictDoNothing()
      .returning();
    subject = inserted ?? (await getSubject("ticker", key));
  }
  if (!subject) throw new Error("could not create subject");

  if (!(await activeRun(subject.id, DISTILL_SKILL))) await startRun(subject, target);
  return subject;
}

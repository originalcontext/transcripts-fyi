import crypto from "node:crypto";

import { and, eq, ne } from "drizzle-orm";

import { anthropic, type DeployTarget } from "@/lib/anthropic";
import { db, schema } from "@/lib/db";
import { activeRun, getSubject } from "@/lib/distill/queries";
import { DISTILL_SKILL } from "@/lib/distill/skill";
import { APP, ensureDistillStack } from "@/lib/distill/stack";

const RUN_BUDGET_CENTS = 1500; // $15 per run (20 quarters)

type Subject = typeof schema.subjects.$inferSelect;

/** Start a fresh distillation run on the current stack (skill + agent at "latest"). */
async function startRun(subject: Subject, target: DeployTarget) {
  const key = subject.key;
  const stack = await ensureDistillStack(target);
  const runId = crypto.randomUUID();
  const session = await anthropic.beta.sessions.create({
    agent: { type: "agent", id: stack.agentId, version: stack.agentVersion },
    environment_id: stack.environmentId,
    title: `${key} · ${DISTILL_SKILL} · ${target}`,
    metadata: { app: APP, target, run_id: runId, subject: key, skill: DISTILL_SKILL },
    budget: { type: "limit", max_list_cost: { amount: String(RUN_BUDGET_CENTS), currency: "USD" } },
    initial_events: [
      { type: "user.message", content: [{ type: "text", text: `Distill ${key} using the ${DISTILL_SKILL} skill.` }] },
    ],
  });
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
  return runId;
}

/** End the subject's live runs (archive their sessions) and start a fresh one. Artifacts are kept. */
export async function regenerateSubject(subjectId: string, target: DeployTarget) {
  const [subject] = await db.select().from(schema.subjects).where(eq(schema.subjects.id, subjectId));
  if (!subject) throw new Error("no such subject");
  const live = await db
    .select()
    .from(schema.runs)
    .where(and(eq(schema.runs.subjectId, subjectId), eq(schema.runs.skill, DISTILL_SKILL), ne(schema.runs.status, "ended")));
  for (const r of live) {
    await anthropic.beta.sessions.archive(r.cmaSessionId).catch(() => {}); // already archived/terminated is fine
    await db.update(schema.runs).set({ status: "ended", lastActivityAt: new Date() }).where(eq(schema.runs.id, r.id));
  }
  return startRun(subject, target);
}

export async function regenerateAll(target: DeployTarget) {
  const all = await db.select().from(schema.subjects);
  for (const s of all) await regenerateSubject(s.id, target);
  return all.length;
}

/** Add a ticker to the universe and start its distillation run if none is active. */
export async function addSubject(key: string, target: DeployTarget) {
  let subject = await getSubject("ticker", key);
    if (!subject) {
    await db
      .insert(schema.subjects)
      .values({ id: crypto.randomUUID(), kind: "ticker", key, displayName: key })
      .onConflictDoNothing();
    subject = await getSubject("ticker", key);
    }
  if (!subject) throw new Error("could not create subject");

  if (!(await activeRun(subject.id, DISTILL_SKILL))) await startRun(subject, target);
  return subject;
}

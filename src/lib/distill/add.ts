import crypto from "node:crypto";
import { anthropic, type DeployTarget } from "@/lib/anthropic";
import { db, schema } from "@/lib/db";
import { activeRun, getSubject } from "@/lib/distill/queries";
import { DISTILL_SKILL } from "@/lib/distill/skill";
import { APP, ensureDistillStack } from "@/lib/distill/stack";

const RUN_BUDGET_CENTS = 1000; // $10 per run

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

  if (!(await activeRun(subject.id, DISTILL_SKILL))) {
    const stack = await ensureDistillStack(target);
    const runId = crypto.randomUUID();
    const session = await anthropic.beta.sessions.create({
      agent: { type: "agent", id: stack.agentId, version: stack.agentVersion },
      environment_id: stack.environmentId,
      title: `${key} · ${DISTILL_SKILL} · ${target}`,
      metadata: { app: APP, target, run_id: runId, subject: key, skill: DISTILL_SKILL },
      budget: { type: "limit", max_list_cost: { amount: String(RUN_BUDGET_CENTS), currency: "USD" } },
      initial_events: [
        {
        type: "user.message",
        content: [{ type: "text", text: `Distill ${key} using the ${DISTILL_SKILL} skill.` }],
        },
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
    });
    }
  return subject;
}

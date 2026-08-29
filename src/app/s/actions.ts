"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { anthropic, deployTarget } from "@/lib/anthropic";
import { db, schema } from "@/lib/db";
import { addSubject } from "@/lib/distill/add";

const BUMP_CENTS = 500;

export async function addSubjectAction(
  _prev: { error?: string; key?: string } | undefined,
  formData: FormData,
): Promise<{ error?: string; key?: string }> {
  const key = String(formData.get("key") ?? "").trim().toUpperCase();
  if (!/^[A-Z.\-]{1,10}$/.test(key)) return { error: "That doesn't look like a ticker." };
  const target = deployTarget();

  try {
    await addSubject(key, target);
  } catch (err) {
    console.error("addSubjectAction", err);
    return { error: err instanceof Error ? err.message : String(err) };
  }
  revalidatePath("/", "layout");
  return { key };
}

export async function bumpBudgetAction(formData: FormData) {
  const runId = String(formData.get("runId") ?? "");
  const [run] = await db.select().from(schema.runs).where(eq(schema.runs.id, runId));
  if (!run) return;
  const s = await anthropic.beta.sessions.retrieve(run.cmaSessionId);
  const consumed = Number(s.usage.list_cost?.amount ?? 0);
  const current = Number(s.budget?.max_list_cost.amount ?? 0);
  await anthropic.beta.sessions.update(run.cmaSessionId, {
    budget: {
      type: "limit",
      max_list_cost: { amount: String(Math.max(current, consumed + 1) + BUMP_CENTS), currency: "USD" },
    },
  });
  revalidatePath("/", "layout");
}

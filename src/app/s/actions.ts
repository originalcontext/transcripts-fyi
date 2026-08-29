"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { anthropic, deployTarget } from "@/lib/anthropic";
import { ADMIN_COOKIE, isAdmin } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { addSubject, regenerateSubject } from "@/lib/distill/runs";
import { userMessage } from "@/lib/errors";

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
    return { error: userMessage(err) };
  }
  return { key }; // client pushes to /s/<key>; every page is force-dynamic, nothing to revalidate
}

export async function bumpBudgetAction(formData: FormData) {
  await requireAdmin();
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

async function requireAdmin() {
  if (!(await isAdmin((await cookies()).get(ADMIN_COOKIE)?.value))) throw new Error("admin only");
}

export async function regenerateSubjectAction(
  _prev: { error?: string } | undefined,
  formData: FormData,
): Promise<{ error?: string; ok?: true }> {
  await requireAdmin();
  try {
    await regenerateSubject(String(formData.get("subjectId") ?? ""), deployTarget());
  } catch (err) {
    console.error("regenerateSubjectAction", err);
    return { error: userMessage(err) };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

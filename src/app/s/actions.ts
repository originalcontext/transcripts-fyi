"use server";

import { revalidatePath } from "next/cache";

import { deployTarget } from "@/lib/anthropic";
import { requireAdmin } from "@/lib/auth-server";
import { addSubject, bumpRunBudget, regenerateSubject } from "@/lib/distill/runs";
import { userMessage } from "@/lib/errors";


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

export async function bumpBudgetAction(_prev: { error?: string; ok?: true } | undefined, formData: FormData): Promise<{ error?: string; ok?: true }> {
  await requireAdmin();
  try {
    await bumpRunBudget(String(formData.get("runId") ?? ""));
  } catch (err) {
    console.error("bumpBudgetAction", err);
    return { error: userMessage(err) };
  }
  revalidatePath("/", "layout");
  return { ok: true };
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

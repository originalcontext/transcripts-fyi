"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { deployTarget } from "@/lib/anthropic";
import { ADMIN_COOKIE, isAdmin } from "@/lib/auth";
import { startSmokeSession } from "@/lib/smoke/session";
import { ensureSmokeStack, findSmokeStack } from "@/lib/smoke/stack";

function message(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

async function requireAdmin() {
  if (!(await isAdmin((await cookies()).get(ADMIN_COOKIE)?.value))) throw new Error("admin only");
}

export async function createStackAction() {
  await requireAdmin();
  try {
    await ensureSmokeStack(deployTarget());
  } catch (err) {
    console.error("createStackAction", err);
    throw err; // surfaces as the route's error boundary; nothing to persist
  }
  revalidatePath("/smoke");
}

export async function runSmokeAction(): Promise<{ sessionId: string } | { error: string }> {
  await requireAdmin();
  const target = deployTarget();
  try {
    const stack = await findSmokeStack(target);
    if (!stack.agent || !stack.environment) return { error: "stack not created yet" };
    const { sessionId } = await startSmokeSession({
      target,
      agentId: stack.agent.id,
      agentVersion: stack.agent.version,
      environmentId: stack.environment.id,
    });
    return { sessionId };
  } catch (err) {
    console.error("runSmokeAction", err);
    return { error: message(err) };
  }
}

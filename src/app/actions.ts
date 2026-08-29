"use server";

import { revalidatePath } from "next/cache";
import { deployTarget } from "@/lib/anthropic";
import { startSmokeSession } from "@/lib/smoke/session";
import { ensureSmokeStack, findSmokeStack } from "@/lib/smoke/stack";

function message(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

export async function createStackAction() {
  try {
    await ensureSmokeStack(deployTarget());
  } catch (err) {
    console.error("createStackAction", err);
    throw err; // surfaces as the route's error boundary; nothing to persist
  }
  revalidatePath("/smoke");
}

export async function runSmokeAction(): Promise<{ sessionId: string } | { error: string }> {
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

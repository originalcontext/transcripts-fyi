import type { DeployTarget } from "@/lib/anthropic";
import { ensureStack, findStack, READ_ONLY_TOOLSET, type StackSpec } from "@/lib/cma/stack";
import { SKILL_MD, SKILL_NAME } from "@/lib/smoke/skill";
import { SMOKE_TOOLS } from "@/lib/smoke/tools";

const smokeSpec = (target: DeployTarget): StackSpec => ({
  app: "tfyi",
  role: "smoke",
  target,
  environment: { name: `transcripts-fyi-smoke-${target}`, description: "ping-pong smoke test — no egress needed" },
  skill: { name: SKILL_NAME, markdown: SKILL_MD },
  agent: {
    name: `transcripts.fyi smoke: ping-pong (${target})`,
    description: "Answers ping with pong through a custom tool. Smoke test only.",
    // The protocol lives ONLY in the skill, so a correct reply proves the skill was loaded.
    system: "You are a smoke-test agent. Your only job is to follow the ping-pong skill precisely. Read it before replying.",
    model: { id: "claude-opus-5", effort: "low" },
    tools: [READ_ONLY_TOOLSET, ...SMOKE_TOOLS],
  },
});

export type SmokeStack = {
  target: DeployTarget;
  environment: { id: string } | null;
  skill: { id: string; version: string } | null;
  agent: { id: string; version: number; toolsCurrent: boolean } | null;
};

const shape = (target: DeployTarget, s: Awaited<ReturnType<typeof findStack>>): SmokeStack => ({
  target,
  environment: s.environmentId ? { id: s.environmentId } : null,
  skill: s.skillId && s.skillVersion ? { id: s.skillId, version: s.skillVersion } : null,
  agent:
    s.agentId && s.agentVersion !== undefined
      ? { id: s.agentId, version: s.agentVersion, toolsCurrent: s.agentCurrent ?? false }
      : null,
});

export const findSmokeStack = async (target: DeployTarget) => shape(target, await findStack(smokeSpec(target)));
export const ensureSmokeStack = async (target: DeployTarget) => shape(target, await ensureStack(smokeSpec(target)));

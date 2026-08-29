import type { DeployTarget } from "@/lib/anthropic";
import { ensureStack, READ_ONLY_TOOLSET, type StackSpec } from "@/lib/cma/stack";
import { DISTILL_SKILL, DISTILL_SKILL_MD } from "@/lib/distill/skill";
import { DISTILL_TOOLS } from "@/lib/distill/tools";

export const APP = "tfyi";

const distillSpec = (target: DeployTarget): StackSpec => ({
  app: APP,
  role: "distiller",
  target,
  environment: { name: `transcripts-fyi-distill-${target}`, description: `earnings-transcript distiller (${target})` },
  skill: { name: DISTILL_SKILL, markdown: DISTILL_SKILL_MD },
  agent: {
    name: `transcripts.fyi distiller (${target})`,
    description: "Longitudinal transcript distiller. Skills decide what kind of transcript.",
    system:
      "You are a longitudinal transcript distiller. Each subject you are given has a skill describing exactly how to fetch its transcripts and what to produce. Read the relevant skill before starting and follow it precisely. Be concrete and quantitative; never pad.",
    model: { id: "claude-opus-5", effort: "high" },
    tools: [READ_ONLY_TOOLSET, ...DISTILL_TOOLS],
  },
});

export const ensureDistillStack = (target: DeployTarget) => ensureStack(distillSpec(target));

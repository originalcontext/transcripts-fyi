import { toFile } from "@anthropic-ai/sdk";
import { anthropic, type DeployTarget } from "@/lib/anthropic";
import { DISTILL_SKILL, DISTILL_SKILL_MD } from "@/lib/distill/skill";
import { DISTILL_TOOLS } from "@/lib/distill/tools";

/**
 * The distiller stack: one environment + one skill + one agent per target,
 * found-or-created from Anthropic's resources (same approach as the smoke).
 * (Duplicates src/lib/smoke/stack.ts on purpose for now — fold together in
 * the simplification pass once there are two real skills.)
 */

export const APP = "tfyi";
const ROLE = "distiller";
const envName = (t: DeployTarget) => `transcripts-fyi-distill-${t}`;

const AGENT_TOOLS = [
  {
    type: "agent_toolset_20260401" as const,
    default_config: { enabled: false },
    configs: [{ name: "read" as const, enabled: true }],
  },
  ...DISTILL_TOOLS,
];
const toolSig = (tools: { type: string; name?: string }[]) =>
  tools.flatMap((t) => (t.type === "custom" && t.name ? [t.name] : [])).sort().join(",");
const DESIRED = toolSig(DISTILL_TOOLS);

export type DistillStack = {
  environmentId: string;
  skillId: string;
  agentId: string;
  agentVersion: number;
};

export async function ensureDistillStack(target: DeployTarget): Promise<DistillStack> {
  let environment = null;
  for await (const e of anthropic.beta.environments.list()) {
    if (e.name === envName(target) && !e.archived_at) environment = e;
  }
  environment ??= await anthropic.beta.environments.create({
    name: envName(target),
    description: `earnings-transcript distiller (${target})`,
    config: { type: "cloud", networking: { type: "limited" } },
    metadata: { app: APP, role: ROLE, target },
  });

  let skill = null;
  for await (const s of anthropic.skills.list()) {
    if (s.display_name === DISTILL_SKILL) skill = s;
  }
  skill ??= await anthropic.skills.create({
    display_name: DISTILL_SKILL,
    files: [await toFile(Buffer.from(DISTILL_SKILL_MD), `${DISTILL_SKILL}/SKILL.md`)],
  });

  let agent = null;
  for await (const a of anthropic.beta.agents.list()) {
    const m = a.metadata ?? {};
    if (m.app !== APP || m.role !== ROLE || m.target !== target || a.archived_at) continue;
    if (!agent || a.created_at > agent.created_at) agent = a;
  }
  if (agent && toolSig(agent.tools) !== DESIRED) {
    agent = await anthropic.beta.agents.update(agent.id, { tools: AGENT_TOOLS, version: agent.version });
  }
  agent ??= await anthropic.beta.agents.create({
    name: `transcripts.fyi distiller (${target})`,
    description: "Longitudinal transcript distiller. Skills decide what kind of transcript.",
    model: { id: "claude-opus-5", effort: "high" },
    system:
      "You are a longitudinal transcript distiller. Each subject you are given has a skill describing exactly how to fetch its transcripts and what to produce. Read the relevant skill before starting and follow it precisely. Be concrete and quantitative; never pad.",
    skills: [{ type: "custom", skill_id: skill.id, version: "latest" }],
    tools: AGENT_TOOLS,
    metadata: { app: APP, role: ROLE, target },
  });

  return { environmentId: environment.id, skillId: skill.id, agentId: agent.id, agentVersion: agent.version };
}

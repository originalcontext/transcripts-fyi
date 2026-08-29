import { toFile } from "@anthropic-ai/sdk";
import crypto from "node:crypto";
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

const SYSTEM =
  "You are a longitudinal transcript distiller. Each subject you are given has a skill describing exactly how to fetch its transcripts and what to produce. Read the relevant skill before starting and follow it precisely. Be concrete and quantitative; never pad.";
const MODEL = { id: "claude-opus-5" as const, effort: "high" as const };

// Everything that changes what a fresh session would do. Stamped on the agent;
// a mismatch publishes a new skill version and a new agent version. Sessions
// already running keep what they started with — "Regenerate" is how they catch up.
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
const SKILL_HASH = sha(DISTILL_SKILL_MD);
const CONFIG_HASH = sha(JSON.stringify({ SYSTEM, MODEL, AGENT_TOOLS, SKILL_HASH }));

export type DistillStack = {
  environmentId: string;
  skillId: string;
  skillVersion: string;
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
  const metadata = { app: APP, role: ROLE, target, config_hash: CONFIG_HASH, skill_hash: SKILL_HASH };
  if (agent && agent.metadata?.config_hash !== CONFIG_HASH) {
    if (agent.metadata?.skill_hash !== SKILL_HASH) {
      skill = await anthropic.skills.versions
        .create(skill.id, { files: [await toFile(Buffer.from(DISTILL_SKILL_MD), `${DISTILL_SKILL}/SKILL.md`)] })
        .then(() => anthropic.skills.retrieve(skill!.id));
    }
    agent = await anthropic.beta.agents.update(agent.id, {
      system: SYSTEM,
      model: MODEL,
      tools: AGENT_TOOLS,
      skills: [{ type: "custom", skill_id: skill.id, version: "latest" }],
      metadata,
      version: agent.version,
    });
  }
  agent ??= await anthropic.beta.agents.create({
    name: `transcripts.fyi distiller (${target})`,
    description: "Longitudinal transcript distiller. Skills decide what kind of transcript.",
    model: MODEL,
    system: SYSTEM,
    skills: [{ type: "custom", skill_id: skill.id, version: "latest" }],
    tools: AGENT_TOOLS,
    metadata,
  });

  return { environmentId: environment.id, skillId: skill.id, skillVersion: skill.latest_version_id, agentId: agent.id, agentVersion: agent.version };
}

import { toFile } from "@anthropic-ai/sdk";
import { anthropic, type DeployTarget } from "@/lib/anthropic";
import { SMOKE_KIND } from "@/lib/smoke/ping-pong";
import { SMOKE_TOOLS } from "@/lib/smoke/tools";
import { SKILL_MD, SKILL_NAME } from "@/lib/smoke/skill";

/**
 * The smoke "stack" is one environment + one skill + one agent per deploy
 * target. Anthropic's resources are the only store: we find by metadata /
 * name and create what is missing. No DB.
 *
 * Singleton is best-effort — two concurrent creates can both miss the find
 * and make two agents. Newest wins on the next find; the extra one is inert.
 */

export type SmokeStack = {
  target: DeployTarget;
  environment: { id: string; name: string } | null;
  skill: { id: string; version: string } | null;
  agent: { id: string; version: number; name: string; created_at: string; toolsCurrent: boolean } | null;
};

const envName = (t: DeployTarget) => `transcripts-fyi-smoke-${t}`;

const AGENT_TOOLS = [
  // Skills need `read`; nothing else built-in is enabled.
  {
    type: "agent_toolset_20260401" as const,
    default_config: { enabled: false },
    configs: [{ name: "read" as const, enabled: true }],
  },
  ...SMOKE_TOOLS,
];

/** Custom tool names an agent currently exposes — the drift signal. */
const customToolNames = (tools: { type: string; name?: string }[]) =>
  tools.flatMap((t) => (t.type === "custom" && t.name ? [t.name] : [])).sort().join(",");
const DESIRED_TOOL_NAMES = customToolNames(SMOKE_TOOLS);

async function findEnvironment(target: DeployTarget) {
  for await (const e of anthropic.beta.environments.list()) {
    if (e.name === envName(target) && !e.archived_at) return e;
  }
  return null;
}

async function findSkill() {
  for await (const s of anthropic.skills.list()) {
    if (s.display_name === SKILL_NAME) return s;
  }
  return null;
}

async function findAgent(target: DeployTarget) {
  let newest = null;
  for await (const a of anthropic.beta.agents.list()) {
    const m = a.metadata ?? {};
    if (m.smoke !== SMOKE_KIND || m.target !== target || a.archived_at) continue;
    if (!newest || a.created_at > newest.created_at) newest = a;
  }
  return newest;
}

export async function findStack(target: DeployTarget): Promise<SmokeStack> {
  const [environment, skill, agent] = await Promise.all([
    findEnvironment(target),
    findSkill(),
    findAgent(target),
  ]);
  return {
    target,
    environment: environment && { id: environment.id, name: environment.name },
    skill: skill && { id: skill.id, version: skill.latest_version_id },
    agent: agent && {
      id: agent.id,
      version: agent.version,
      name: agent.name,
      created_at: agent.created_at,
      toolsCurrent: customToolNames(agent.tools) === DESIRED_TOOL_NAMES,
    },
  };
}

export async function ensureStack(target: DeployTarget): Promise<SmokeStack> {
  const environment =
    (await findEnvironment(target)) ??
    (await anthropic.beta.environments.create({
      name: envName(target),
      description: `ping-pong smoke test (${target}) — no egress needed`,
      config: { type: "cloud", networking: { type: "limited" } },
      metadata: { smoke: SMOKE_KIND, target },
    }));

  // Skill is content, not deployment-specific: one shared across targets.
  // (No content diffing — editing SKILL_MD needs a manual new version.)
  const skill =
    (await findSkill()) ??
    (await anthropic.skills.create({
      display_name: SKILL_NAME,
      files: [await toFile(Buffer.from(SKILL_MD), `${SKILL_NAME}/SKILL.md`)],
    }));

  let agent = await findAgent(target);
  if (agent && customToolNames(agent.tools) !== DESIRED_TOOL_NAMES) {
    // Tool set changed in code → publish a new agent version (optimistic lock).
    agent = await anthropic.beta.agents.update(agent.id, { tools: AGENT_TOOLS, version: agent.version });
  }
  agent ??= await anthropic.beta.agents.create({
      name: `transcripts.fyi smoke: ping-pong (${target})`,
      description: "Answers ping with pong through a custom tool. Smoke test only.",
      model: { id: "claude-opus-5", effort: "low" },
      // The protocol lives ONLY in the skill, so a correct reply proves the
      // skill was loaded.
      system:
        "You are a smoke-test agent. Your only job is to follow the ping-pong skill precisely. Read it before replying.",
      skills: [{ type: "custom", skill_id: skill.id, version: "latest" }],
      tools: AGENT_TOOLS,
      metadata: { smoke: SMOKE_KIND, target },
    });

  return {
    target,
    environment: { id: environment.id, name: environment.name },
    skill: { id: skill.id, version: skill.latest_version_id },
    agent: { id: agent.id, version: agent.version, name: agent.name, created_at: agent.created_at, toolsCurrent: true },
  };
}

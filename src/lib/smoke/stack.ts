import { toFile } from "@anthropic-ai/sdk";
import { anthropic, type DeployTarget } from "@/lib/anthropic";
import { PONG_TOOL, SMOKE_KIND } from "@/lib/smoke/ping-pong";
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
  agent: { id: string; version: number; name: string; created_at: string } | null;
};

const envName = (t: DeployTarget) => `transcripts-fyi-smoke-${t}`;

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

  const agent =
    (await findAgent(target)) ??
    (await anthropic.beta.agents.create({
      name: `transcripts.fyi smoke: ping-pong (${target})`,
      description: "Answers ping with pong through a custom tool. Smoke test only.",
      model: { id: "claude-opus-5", effort: "low" },
      // The protocol lives ONLY in the skill, so a correct reply proves the
      // skill was loaded.
      system:
        "You are a smoke-test agent. Your only job is to follow the ping-pong skill precisely. Read it before replying.",
      skills: [{ type: "custom", skill_id: skill.id, version: "latest" }],
      tools: [
        // Skills need `read`; nothing else is enabled.
        {
          type: "agent_toolset_20260401",
          default_config: { enabled: false },
          configs: [{ name: "read", enabled: true }],
        },
        {
          type: "custom",
          name: PONG_TOOL,
          description:
            "Echo service for the ping-pong protocol. Call it exactly once when the user sends `ping <nonce>`, passing the nonce verbatim. It returns JSON containing `reply`, the same `nonce`, and `handled_by` (which deployment answered). It has no other purpose and must not be called otherwise.",
          input_schema: {
            type: "object",
            properties: {
              nonce: { type: "string", description: "The nonce token from the ping message, verbatim." },
            },
            required: ["nonce"],
          },
        },
      ],
      metadata: { smoke: SMOKE_KIND, target },
    }));

  return {
    target,
    environment: { id: environment.id, name: environment.name },
    skill: { id: skill.id, version: skill.latest_version_id },
    agent: { id: agent.id, version: agent.version, name: agent.name, created_at: agent.created_at },
  };
}

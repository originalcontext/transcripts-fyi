import crypto from "node:crypto";

import type Anthropic from "@anthropic-ai/sdk";
import { toFile } from "@anthropic-ai/sdk";

import { anthropic, type DeployTarget } from "@/lib/anthropic";
import { key, redis } from "@/lib/redis";

/**
 * Find-or-create a CMA "stack": one environment + one skill + one agent per
 * deploy target, with Anthropic's resources as the only store.
 *
 * - environment: found by name; never updated (changes need a new name)
 * - skill: found by display name; a new *version* is published when its
 *   markdown hash changes
 * - agent: found by metadata (app/role/target); a new *version* is published
 *   when the config hash (skill md + system + model + tools) changes
 *
 * Running sessions keep the versions they started with; new sessions get
 * "latest". Best-effort singleton: two concurrent creates can race — newest
 * wins on the next find and the stray is inert.
 */

export type StackSpec = {
  app: string;
  role: string;
  target: DeployTarget;
  environment: { name: string; description: string };
  skill: { name: string; markdown: string };
  agent: {
    name: string;
    description: string;
    system: string;
    model: Anthropic.Beta.Agents.BetaManagedAgentsModelConfigParams;
    tools: Anthropic.Beta.Agents.AgentCreateParams["tools"];
  };
};

export type Stack = {
  environmentId: string;
  skillId: string;
  skillVersion: string;
  agentId: string;
  agentVersion: number;
  agentCurrent: boolean;
};

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);

function hashes(spec: StackSpec) {
  const skill_hash = sha(spec.skill.markdown);
  // Key names are part of the hash — keep them stable or every agent re-versions.
  const config_hash = sha(JSON.stringify({ SYSTEM: spec.agent.system, MODEL: spec.agent.model, AGENT_TOOLS: spec.agent.tools, SKILL_HASH: skill_hash }));
  return { skill_hash, config_hash };
}

async function findEnvironment(spec: StackSpec) {
  for await (const e of anthropic.beta.environments.list()) {
    if (e.name === spec.environment.name && !e.archived_at) return e;
  }
  return null;
}

async function findSkill(spec: StackSpec) {
  for await (const s of anthropic.skills.list()) {
    if (s.display_name === spec.skill.name) return s;
  }
  return null;
}

async function findAgent(spec: StackSpec) {
  let newest = null;
  for await (const a of anthropic.beta.agents.list()) {
    const m = a.metadata ?? {};
    if (m.app !== spec.app || m.role !== spec.role || m.target !== spec.target || a.archived_at) continue;
    if (!newest || a.created_at > newest.created_at) newest = a;
  }
  return newest;
}

/** Read-only: what exists right now, and whether the agent matches the code. */
export async function findStack(spec: StackSpec): Promise<Partial<Stack>> {
  const [environment, skill, agent] = await Promise.all([findEnvironment(spec), findSkill(spec), findAgent(spec)]);
  return {
    environmentId: environment?.id,
    skillId: skill?.id,
    skillVersion: skill?.latest_version_id,
    agentId: agent?.id,
    agentVersion: agent?.version,
    agentCurrent: agent ? agent.metadata?.config_hash === hashes(spec).config_hash : undefined,
  };
}

const STACK_TTL_S = 60 * 60 * 24 * 30;
const cacheKey = (spec: StackSpec, config_hash: string) => key("stack", spec.app, spec.role, config_hash); // key() already prefixes the target

/** Drop the cached ids (e.g. after a 404 proved them stale); the next ensureStack takes the slow path. */
export async function forgetStack(spec: StackSpec) {
  await redis.del(cacheKey(spec, hashes(spec).config_hash));
}

/**
 * Happy path: one Redis read. Miss (first run, config changed, TTL): find-or-
 * create against Anthropic's resources — which stay the source of truth —
 * then remember the ids under this hash.
 */
export async function ensureStack(spec: StackSpec): Promise<Stack> {
  const { config_hash } = hashes(spec);
  const k = cacheKey(spec, config_hash);
  const hit = await redis.get<Stack>(k).catch(() => null);
  if (hit) return { ...hit, agentCurrent: true };
  const stack = await resolveStack(spec);
  await redis.set(k, stack, { ex: STACK_TTL_S }).catch(() => {});
  return stack;
}

/** The slow path: find-or-create + hash-drift versioning against Anthropic's resources. */
async function resolveStack(spec: StackSpec): Promise<Stack> {
  const { skill_hash, config_hash } = hashes(spec);
  const skillFile = async () => [await toFile(Buffer.from(spec.skill.markdown), `${spec.skill.name}/SKILL.md`)];

  const environment =
    (await findEnvironment(spec)) ??
    (await anthropic.beta.environments.create({
      name: spec.environment.name,
      description: spec.environment.description,
      config: { type: "cloud", networking: { type: "limited" } },
      metadata: { app: spec.app, role: spec.role, target: spec.target },
    }));

  let skill =
    (await findSkill(spec)) ??
    (await anthropic.skills.create({ display_name: spec.skill.name, files: await skillFile() }));

  let agent = await findAgent(spec);
  const metadata = { app: spec.app, role: spec.role, target: spec.target, config_hash, skill_hash };
  const skills = [{ type: "custom" as const, skill_id: skill.id, version: "latest" }];

  if (agent && agent.metadata?.config_hash !== config_hash) {
    if (agent.metadata?.skill_hash !== skill_hash) {
      await anthropic.skills.versions.create(skill.id, { files: await skillFile() });
      skill = await anthropic.skills.retrieve(skill.id);
    }
    agent = await anthropic.beta.agents.update(agent.id, {
      system: spec.agent.system,
      model: spec.agent.model,
      tools: spec.agent.tools,
      skills,
      metadata,
      version: agent.version,
    });
  }
  agent ??= await anthropic.beta.agents.create({
    name: spec.agent.name,
    description: spec.agent.description,
    model: spec.agent.model,
    system: spec.agent.system,
    skills,
    tools: spec.agent.tools,
    metadata,
  });

  return {
    environmentId: environment.id,
    skillId: skill.id,
    skillVersion: skill.latest_version_id,
    agentId: agent.id,
    agentVersion: agent.version,
    agentCurrent: true,
  };
}

/** Skills need `read`; nothing else built-in. Used by the smoke stack (the distiller adds write/edit for notes). */
export const READ_ONLY_TOOLSET = {
  type: "agent_toolset_20260401" as const,
  default_config: { enabled: false },
  configs: [{ name: "read" as const, enabled: true }],
};

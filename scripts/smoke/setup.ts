/**
 * Control plane, run once per workspace (idempotent via .smoke.json):
 *   environment + skill + agent for the ping-pong smoke test.
 *
 *   npm run smoke:setup            # creates if .smoke.json is absent
 *   npm run smoke:setup -- --force # recreate everything
 *
 * Needs ANTHROPIC_API_KEY (or an `ant auth login` profile).
 */
import fs from "node:fs";
import path from "node:path";
import { toFile } from "@anthropic-ai/sdk";
import { anthropic } from "@/lib/anthropic";
import { PONG_TOOL } from "@/lib/smoke/ping-pong";

const ROOT = path.resolve(import.meta.dirname, "../..");
const STATE = path.join(ROOT, ".smoke.json");
const ENV_NAME = "transcripts-fyi-smoke";

export type SmokeState = {
  environment_id: string;
  skill_id: string;
  agent_id: string;
  agent_version: number;
  created_at: string;
};

async function main() {
  const force = process.argv.includes("--force");
  if (fs.existsSync(STATE) && !force) {
    console.log(`already set up — ${STATE} exists (use --force to recreate)`);
    console.log(fs.readFileSync(STATE, "utf8"));
    return;
  }

  // Environment. Names are unique per workspace → reuse on 409.
  let environment;
  try {
    environment = await anthropic.beta.environments.create({
      name: ENV_NAME,
      description: "ping-pong smoke test — no egress needed",
      config: { type: "cloud", networking: { type: "limited" } },
    });
    console.log("environment created", environment.id);
  } catch (err) {
    if (!(err instanceof Error && "status" in err && err.status === 409)) throw err;
    for await (const e of anthropic.beta.environments.list()) {
      if (e.name === ENV_NAME) environment = e;
    }
    if (!environment) throw new Error(`409 on create but no environment named ${ENV_NAME}`);
    console.log("environment reused", environment.id);
  }

  // Skill. Files must share one top-level dir containing SKILL.md.
  const skillPath = path.join(ROOT, "smoke/skills/ping-pong/SKILL.md");
  const skill = await anthropic.skills.create({
    display_name: "ping-pong",
    files: [await toFile(fs.readFileSync(skillPath), "ping-pong/SKILL.md")],
  });
  console.log("skill created", skill.id, "version", skill.latest_version_id);

  // Agent. The protocol lives ONLY in the skill — the system prompt just
  // points at it — so a correct reply proves the skill was actually loaded.
  const agent = await anthropic.beta.agents.create({
    name: "transcripts.fyi smoke: ping-pong",
    description: "Answers ping with pong through a custom tool. Smoke test only.",
    model: { id: "claude-opus-5", effort: "low" },
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
    metadata: { smoke: "ping-pong" },
  });
  console.log("agent created", agent.id, "version", agent.version);

  const state: SmokeState = {
    environment_id: environment.id,
    skill_id: skill.id,
    agent_id: agent.id,
    agent_version: agent.version,
    created_at: new Date().toISOString(),
  };
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2) + "\n");
  console.log(`wrote ${STATE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

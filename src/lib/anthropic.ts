import Anthropic from "@anthropic-ai/sdk";

/**
 * One client for the whole app. Reads ANTHROPIC_API_KEY and
 * ANTHROPIC_WEBHOOK_SIGNING_KEY from the environment.
 */
// 4 attempts on 429/5xx/network; 20s per attempt (the SDK default is 10 minutes — far past any function budget).
export const anthropic = new Anthropic({ maxRetries: 4, timeout: 20_000 });

export type DeployTarget = "prod" | "dev";

/**
 * Which deployment this process is. Both the production app and a local dev
 * server subscribe to the same Anthropic webhooks (same workspace), so every
 * handler must decide whether an event is *its* to act on. Sessions carry
 * `metadata.target`; handlers compare it against this.
 */
export function deployTarget(): DeployTarget {
  const explicit = process.env.SMOKE_TARGET;
  if (explicit === "prod" || explicit === "dev") return explicit;
  return process.env.VERCEL_ENV === "production" ? "prod" : "dev";
}

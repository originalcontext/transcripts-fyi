import { Redis } from "@upstash/redis";
import { deployTarget } from "@/lib/anthropic";

/**
 * Upstash over REST — every command is an HTTPS request. One Redis is shared
 * by dev and prod for now, so every key goes through `key()` to get a target
 * prefix. If that ever feels fragile, split the databases; don't get clever.
 */
function config() {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error("KV_REST_API_URL / KV_REST_API_TOKEN are not set");
  return { url, token };
}

export const redis = new Redis(config());

export const key = (...parts: string[]) => [deployTarget(), ...parts].join(":");

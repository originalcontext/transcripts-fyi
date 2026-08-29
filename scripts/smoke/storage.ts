/**
 * Storage smoke: one round trip each to Neon (HTTP) and Upstash (REST).
 *   npm run smoke:storage                              # dev (.env.local)
 *   ENV_FILE=.env.prod.local SMOKE_TARGET=prod npm run smoke:storage
 */
import { checkStorage } from "@/lib/smoke/storage";

checkStorage().then((checks) => {
  for (const c of checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}  ${c.detail}`);
  process.exit(checks.every((c) => c.ok) ? 0 : 1);
});

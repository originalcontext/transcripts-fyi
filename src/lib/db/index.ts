import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "@/lib/db/schema";

/**
 * Neon over HTTP: one fetch per query, no connection, no pool, nothing to
 * leak across serverless invocations. Transactions are not available on this
 * driver — if we ever need one, that is the moment to revisit, not before.
 */
function url() {
  const u = process.env.DATABASE_URL;
  if (!u) throw new Error("DATABASE_URL is not set");
  return u;
}

export const db = drizzle(neon(url()), { schema });
export { schema };

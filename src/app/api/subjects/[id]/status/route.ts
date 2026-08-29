import { desc, eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";

/** Mainline poll target: the two facts that can change while a run works. Postgres only. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [[run], [artifact]] = await Promise.all([
    db.select({ status: schema.runs.status }).from(schema.runs).where(eq(schema.runs.subjectId, id)).orderBy(desc(schema.runs.createdAt)).limit(1),
    db.select({ at: schema.artifacts.createdAt }).from(schema.artifacts).where(eq(schema.artifacts.subjectId, id)).orderBy(desc(schema.artifacts.createdAt)).limit(1),
  ]);
  return Response.json({ status: run?.status ?? null, latestArtifactAt: artifact?.at?.toISOString() ?? null }, { headers: { "cache-control": "no-store" } });
}

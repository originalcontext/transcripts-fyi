import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, isAdmin } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { sessionTrace } from "@/lib/distill/queries";

/** The sausage. Hits CMA live; fetched by the client after the page has rendered. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin((await cookies()).get(ADMIN_COOKIE)?.value))) return new Response("admin only", { status: 403 });
  const { id } = await ctx.params;
  const [run] = await db.select().from(schema.runs).where(eq(schema.runs.id, id));
  if (!run) return new Response("not found", { status: 404 });
  try {
    return Response.json({ run: { id: run.id, cmaSessionId: run.cmaSessionId, cmaAgentId: run.cmaAgentId, cmaAgentVersion: run.cmaAgentVersion }, trace: await sessionTrace(run.cmaSessionId) });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}

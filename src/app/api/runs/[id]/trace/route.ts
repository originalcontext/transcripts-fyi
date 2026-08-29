import { eq } from "drizzle-orm";

import { viewerIsAdmin } from "@/lib/auth-server";
import { db, schema } from "@/lib/db";
import { sessionTrace, type TraceResponse } from "@/lib/distill/trace";
import { errorMessage } from "@/lib/errors";

/** The sausage. Hits CMA live; fetched by the client after the page has rendered. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await viewerIsAdmin())) return new Response("admin only", { status: 403 });
  const { id } = await ctx.params;
  const [run] = await db.select().from(schema.runs).where(eq(schema.runs.id, id));
  if (!run) return new Response("not found", { status: 404 });
  try {
    const body: TraceResponse = {
      run: { id: run.id, cmaSessionId: run.cmaSessionId, cmaAgentId: run.cmaAgentId, cmaAgentVersion: run.cmaAgentVersion, cmaSkillVersion: run.cmaSkillVersion },
      trace: await sessionTrace(run.cmaSessionId),
    };
    return Response.json(body);
  } catch (err) {
    return Response.json({ error: errorMessage(err) }, { status: 502 });
  }
}

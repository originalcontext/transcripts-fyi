import { cookies } from "next/headers";

import { ADMIN_COOKIE, isAdmin } from "@/lib/auth";
import { inspectSmokeSession } from "@/lib/smoke/session";

export async function GET(_req: Request, ctx: { params: Promise<{ sessionId: string }> }) {
  if (!(await isAdmin((await cookies()).get(ADMIN_COOKIE)?.value))) return new Response("admin only", { status: 403 });
  const { sessionId } = await ctx.params;
  if (!/^sesn_[A-Za-z0-9]+$/.test(sessionId)) return new Response("bad id", { status: 400 });
  try {
    return Response.json(await inspectSmokeSession(sessionId));
  } catch (err) {
    console.error("inspect", err);
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}

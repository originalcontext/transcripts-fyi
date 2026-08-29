import { isCronAuthorized } from "@/lib/ops/cron-auth";
import { gc } from "@/lib/ops/gc";

export const maxDuration = 60;

/** Vercel Cron: archive sessions of long-ended runs, prune webhook dedupe rows. `?dry=1` to report only. */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return new Response("unauthorized", { status: 401 });
  const dry = new URL(request.url).searchParams.get("dry") === "1";
  const report = await gc({ apply: !dry });
  console.log("cron:gc", JSON.stringify(report));
  return Response.json(report);
}

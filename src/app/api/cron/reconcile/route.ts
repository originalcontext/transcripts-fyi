import { isCronAuthorized } from "@/lib/ops/cron-auth";
import { reconcile } from "@/lib/ops/reconcile";

export const maxDuration = 60;

/** Vercel Cron: repair anything a dropped webhook left behind. `?dry=1` to report only. */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return new Response("unauthorized", { status: 401 });
  const dry = new URL(request.url).searchParams.get("dry") === "1";
  const report = await reconcile({ apply: !dry });
  console.log("cron:reconcile", JSON.stringify(report));
  return Response.json(report);
}

import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { Sausage } from "@/components/app/sausage";
import { Shell } from "@/components/app/shell";
import { ADMIN_COOKIE, isAdmin } from "@/lib/auth";
import { activeRun, getSubject, latestArtifact } from "@/lib/distill/queries";
import { DISTILL_SKILL } from "@/lib/distill/skill";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  working: "distilling — report coming soon",
  idle: "up to date",
  budget_reached: "paused — budget reached",
  ended: "ended",
};

/** Mainline: this render touches Postgres only. Everything CMA-shaped is in <Sausage/>. */
export default async function SubjectPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const subject = await getSubject("ticker", key.toUpperCase());
  if (!subject) notFound();

  const [artifact, run, admin] = await Promise.all([
    latestArtifact(subject.id),
    activeRun(subject.id, DISTILL_SKILL),
    isAdmin((await cookies()).get(ADMIN_COOKIE)?.value),
  ]);
  const working = run?.status === "working";

  return (
    <Shell current={subject.key}>
      <AutoRefresh active={working} />

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b px-4 py-2 text-sm">
          <div className="font-medium">{subject.key}</div>
          <div className="text-xs text-muted-foreground">
            {artifact &&
              `latest ${artifact.createdAt.toISOString().replace("T", " ").slice(0, 16)} · ${String((artifact.meta as { quarters?: string[] }).quarters?.length ?? "?")} quarters · `}
            {run ? `${STATUS_LABEL[run.status] ?? run.status} · $${(run.listCostCents / 100).toFixed(2)}` : "no run"}
          </div>
        </div>
        {artifact ? (
          <iframe title={`${subject.key} explainer`} srcDoc={artifact.content} sandbox="" className="h-full w-full flex-1 bg-white" />
        ) : (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            {working ? "Reading the last eight calls…" : "Nothing here yet."}
          </div>
        )}
      </main>

      {admin && (
        <aside className="w-96 shrink-0 overflow-y-auto border-l p-3 text-xs">
          <div className="mb-2 font-medium">How the sausage was made</div>
          {run ? <Sausage runId={run.id} subjectId={subject.id} live={working} /> : <p className="text-muted-foreground">no run</p>}
        </aside>
      )}
    </Shell>
  );
}

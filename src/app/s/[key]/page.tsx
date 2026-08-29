import { cookies } from "next/headers";
import { notFound } from "next/navigation";

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

/** The mainline reads, timed. Postgres only — everything CMA-shaped is in <Sausage/>. */
async function loadHotPath(subjectId: string) {
  const t0 = performance.now();
  const [artifact, run, admin] = await Promise.all([
    latestArtifact(subjectId),
    activeRun(subjectId, DISTILL_SKILL),
    isAdmin((await cookies()).get(ADMIN_COOKIE)?.value),
  ]);
  return { artifact, run, admin, hotPathMs: Math.round(performance.now() - t0) };
}

export default async function SubjectPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const subject = await getSubject("ticker", key.toUpperCase());
  if (!subject) notFound();

  const { artifact, run, admin, hotPathMs } = await loadHotPath(subject.id);
  const working = run?.status === "working";

  return (
    <Shell current={subject.key}>
      <AutoRefresh active={working} />

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b px-4 py-2 text-sm">
          <div className="flex items-center gap-3">
            <span className="font-medium">{subject.key}</span>
            <span className="rounded bg-emerald-500/10 px-2 py-0.5 font-mono text-[11px] text-emerald-700 dark:text-emerald-400" title="This render: Postgres only. Never waits on CMA.">
              hot path · postgres · {hotPathMs}ms · $0/view
            </span>
          </div>
          <div className="text-xs text-muted-foreground">
            {artifact &&
              `latest ${artifact.createdAt.toISOString().replace("T", " ").slice(0, 16)} · ${String((artifact.meta as { quarters?: string[] }).quarters?.length ?? "?")} quarters · `}
            {run ? `${STATUS_LABEL[run.status] ?? run.status} · $${(run.listCostCents / 100).toFixed(2)}` : "no run"}
          </div>
        </div>
        {artifact ? (
          <iframe title={`${subject.key} explainer`} srcDoc={artifact.content} sandbox="" className="h-full w-full flex-1 bg-[#0a0a0a]" />
        ) : (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            {working ? "Reading the last eight calls…" : "Nothing here yet."}
          </div>
        )}
      </main>

      {admin && (
        <aside className="w-[26rem] shrink-0 overflow-y-auto border-l border-amber-500/30 bg-amber-500/[0.04] p-3 text-xs dark:bg-amber-400/[0.05]">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-medium text-amber-800 dark:text-amber-300">How the sausage was made</span>
            <span className="font-mono text-[10px] text-amber-700/80 dark:text-amber-400/80">admin · live from CMA</span>
          </div>
          {run ? <Sausage runId={run.id} subjectId={subject.id} live={working} /> : <p className="text-muted-foreground">no run</p>}
        </aside>
      )}
    </Shell>
  );
}

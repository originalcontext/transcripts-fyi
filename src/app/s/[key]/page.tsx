import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { AutoRefresh } from "@/components/app/auto-refresh";
import { Sausage } from "@/components/app/sausage";
import { SausageLayout } from "@/components/app/sausage-layout";
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
    <Shell current={subject.key} hotPathMs={hotPathMs}>
      <AutoRefresh active={working} />

      <SausageLayout
        header={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span className="font-medium">{subject.key}</span>
            <span className="text-xs text-muted-foreground">
              {artifact &&
                `latest ${artifact.createdAt.toISOString().replace("T", " ").slice(0, 16)} · ${String((artifact.meta as { quarters?: string[] }).quarters?.length ?? "?")} quarters · `}
              {run ? `${STATUS_LABEL[run.status] ?? run.status} · $${(run.listCostCents / 100).toFixed(2)}` : "no run"}
            </span>
          </div>
        }
        panel={admin ? run ? <Sausage runId={run.id} subjectId={subject.id} live={working} /> : <p className="text-muted-foreground">no run</p> : null}
      >
        {artifact ? (
          <iframe title={`${subject.key} explainer`} srcDoc={artifact.content} sandbox="" className="h-full w-full flex-1 bg-[#0a0a0a]" />
        ) : (
          <div className="flex flex-1 items-center justify-center p-6 text-center text-muted-foreground">
            {working ? "Reading the last eight calls…" : "Nothing here yet."}
          </div>
        )}
      </SausageLayout>
    </Shell>
  );
}

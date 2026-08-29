import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { ArtifactFrame } from "@/components/app/artifact-frame";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { RequestUpdate } from "@/components/app/request-update";
import { Sausage } from "@/components/app/sausage";
import { SausageLayout } from "@/components/app/sausage-layout";
import { Shell } from "@/components/app/shell";
import { injectArtifactHead } from "@/lib/artifact/imports";
import { ADMIN_COOKIE, isAdmin } from "@/lib/auth";
import { activeRun, getSubject, latestArtifact } from "@/lib/distill/queries";
import { DISTILL_SKILL } from "@/lib/distill/skill";
import { timeAgo } from "@/lib/utils";

export const dynamic = "force-dynamic";

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
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="font-medium">{subject.key}</span>
            <span className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
              {artifact && (
                <time dateTime={artifact.createdAt.toISOString()} title={artifact.createdAt.toUTCString()}>
                  Updated {timeAgo(artifact.createdAt)}
                </time>
              )}
              {working ? (
                <span>{artifact ? "Updating…" : "Distilling — report coming soon"}</span>
              ) : run?.status === "budget_reached" ? (
                <span>Paused (budget)</span>
              ) : run?.status === "ended" ? (
                <span>Ended</span>
              ) : admin ? (
                <RequestUpdate subjectId={subject.id} />
              ) : null}
            </span>
          </div>
        }
        panel={admin ? run ? <Sausage runId={run.id} subjectId={subject.id} live={working} /> : <p className="text-muted-foreground">no run</p> : null}
      >
        {artifact ? (
          <ArtifactFrame title={`${subject.key} explainer`} srcDoc={injectArtifactHead(artifact.content)} />
        ) : (
          <div className="flex flex-1 items-center justify-center p-6 text-center text-neutral-400">
            {working ? "Reading the last twenty calls…" : "Nothing here yet."}
          </div>
        )}
      </SausageLayout>
    </Shell>
  );
}

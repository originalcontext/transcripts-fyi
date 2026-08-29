import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ArtifactFrame } from "@/components/app/artifact-frame";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { RequestUpdate } from "@/components/app/request-update";
import { Sausage } from "@/components/app/sausage";
import { SausageLayout } from "@/components/app/sausage-layout";
import { Shell } from "@/components/app/shell";
import { WorkingHero } from "@/components/app/working-hero";
import { injectArtifactHead } from "@/lib/artifact/imports";
import { viewerIsAdmin } from "@/lib/auth-server";
import { activeRunFor, getSubject, latestArtifactFor, listUniverse } from "@/lib/distill/queries";
import { DISTILL_SKILL } from "@/lib/distill/skill";
import { companyName } from "@/lib/tickers";
import { timeAgo } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }): Promise<Metadata> {
  const key = (await params).key.toUpperCase();
  const name = companyName(key);
  const title = name ? `${key} · ${name}` : key;
  const description = `${name ?? key}, through five years of earnings calls — one interactive explainer of how the story changed.`;
  return { title, description, openGraph: { title, description }, twitter: { title, description } };
}

/** The mainline reads, timed. Postgres only — everything CMA-shaped is in <Sausage/>. */
async function loadHotPath(key: string) {
  const t0 = performance.now();
  const [subject, artifact, run, universe, admin] = await Promise.all([
    getSubject("ticker", key),
    latestArtifactFor("ticker", key),
    activeRunFor("ticker", key, DISTILL_SKILL),
    listUniverse(),
    viewerIsAdmin(),
  ]);
  return { subject, artifact, run, universe, admin, hotPathMs: Math.round(performance.now() - t0) };
}

export default async function SubjectPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const { subject, artifact, run, universe, admin, hotPathMs } = await loadHotPath(key.toUpperCase());
  if (!subject) notFound();
  const working = run?.status === "working";

  return (
    <Shell current={subject.key} universe={universe} hotPathMs={hotPathMs}>
      <AutoRefresh active={!!run && working} subjectId={subject.id} />

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
          working ? (
            <WorkingHero subject={subject.key} />
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-neutral-400">Nothing here yet.</div>
          )
        )}
      </SausageLayout>
    </Shell>
  );
}

import { notFound } from "next/navigation";
import { bumpBudgetAction } from "@/app/s/actions";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { Shell } from "@/components/app/shell";
import { Button } from "@/components/ui/button";
import { activeRun, getSubject, latestArtifact, sessionTrace } from "@/lib/distill/queries";
import { DISTILL_SKILL } from "@/lib/distill/skill";

export const dynamic = "force-dynamic";

export default async function SubjectPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const subject = await getSubject("ticker", key.toUpperCase());
  if (!subject) notFound();

  const [artifact, run] = await Promise.all([latestArtifact(subject.id), activeRun(subject.id, DISTILL_SKILL)]);
  const trace = run ? await sessionTrace(run.cmaSessionId) : null;
  const working = trace?.status === "running" || trace?.status === "rescheduling" || (trace?.status === "idle" && trace.stop === "requires_action");

  return (
    <Shell current={subject.key}>
      <AutoRefresh active={!!run && (working || !artifact)} />

      {/* middle: the artifact */}
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b px-4 py-2 text-sm">
          <div className="font-medium">{subject.key}</div>
          <div className="text-xs text-muted-foreground">
            {artifact
              ? `latest ${artifact.createdAt.toISOString().replace("T", " ").slice(0, 16)} · ${String((artifact.meta as { quarters?: string[] }).quarters?.length ?? "?")} quarters`
              : working
                ? "distilling — report coming soon"
                : "no report yet"}
          </div>
        </div>
        {artifact ? (
          <iframe
            title={`${subject.key} explainer`}
            srcDoc={artifact.content}
            sandbox=""
            className="h-full w-full flex-1 bg-white"
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            {working ? "Reading the last eight calls…" : "Nothing here yet."}
          </div>
        )}
      </main>

      {/* right: how the sausage was made */}
      <aside className="w-96 shrink-0 overflow-y-auto border-l p-3 text-xs">
        <div className="mb-2 font-medium">How the sausage was made</div>
        {!run || !trace ? (
          <p className="text-muted-foreground">no run</p>
        ) : (
          <>
            <dl className="mb-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono">
              <dt className="text-muted-foreground">session</dt>
              <dd><a className="underline" href={trace.traceUrl} target="_blank" rel="noreferrer">{run.cmaSessionId}</a></dd>
              <dt className="text-muted-foreground">status</dt>
              <dd>{trace.status}{trace.stop ? ` (${trace.stop})` : ""}</dd>
              <dt className="text-muted-foreground">cost</dt>
              <dd>${(trace.listCostCents / 100).toFixed(2)} of ${(trace.budgetCents / 100).toFixed(2)}</dd>
              <dt className="text-muted-foreground">tokens</dt>
              <dd>{(trace.inputTokens ?? 0).toLocaleString()} in / {(trace.outputTokens ?? 0).toLocaleString()} out</dd>
              <dt className="text-muted-foreground">agent</dt>
              <dd>{run.cmaAgentId} v{run.cmaAgentVersion}</dd>
            </dl>
            <form action={bumpBudgetAction} className="mb-3">
              <input type="hidden" name="runId" value={run.id} />
              <Button type="submit" size="sm" variant={trace.stop === "budget_reached" ? "default" : "outline"}>
                {trace.stop === "budget_reached" ? "Budget reached — bump +$5" : "Bump budget +$5"}
              </Button>
            </form>
            <ol className="space-y-1 font-mono">
              {trace.events.map((e) => (
                <li key={e.id} className="grid grid-cols-[auto_1fr] gap-x-2">
                  <span className="text-muted-foreground">{e.at?.slice(11, 19)}</span>
                  <span className="min-w-0 break-words">
                    <span className={e.type.startsWith("agent.") ? "text-foreground" : "text-muted-foreground"}>{e.type}</span>
                    {e.detail && <span className="text-muted-foreground"> {e.detail}</span>}
                  </span>
                </li>
              ))}
            </ol>
          </>
        )}
      </aside>
    </Shell>
  );
}

"use client";

import { useEffect, useState } from "react";

import { bumpBudgetAction } from "@/app/s/actions";
import { RequestUpdate } from "@/components/app/request-update";
import { Button } from "@/components/ui/button";

type Trace = {
  run: { id: string; cmaSessionId: string; cmaAgentId: string; cmaAgentVersion: number; cmaSkillVersion: string | null };
  trace: {
    status: string;
    stop: string | null;
    listCostCents: number;
    budgetCents: number;
    wallS: number;
    modelRequests: number;
    tokens: { in: number; cacheRead: number; cacheWrite: number; out: number };
    eventCount: number;
    events: { id: string; type: string; at: string | null; elapsedS: number | null; detail: string }[];
    traceUrl: string;
  };
};

/**
 * "How the sausage was made." Fetched after mount so the page's server render
 * never waits on CMA; admins and non-admins get the same TTFB. Refetches on an
 * interval while the run is live.
 */
export function Sausage({ runId, subjectId, live }: { runId: string; subjectId: string; live: boolean }) {
  const [data, setData] = useState<Trace | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "forbidden" | "error">("loading");
  const [fetchMs, setFetchMs] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const t0 = performance.now();
      const res = await fetch(`/api/runs/${runId}/trace`, { cache: "no-store" });
      if (cancelled) return;
      setFetchMs(Math.round(performance.now() - t0));
      if (res.status === 403) return setState("forbidden");
      if (!res.ok) return setState("error");
      setData((await res.json()) as Trace);
      setState("ok");
    }
    load();
    const t = live ? setInterval(load, 5000) : undefined;
    return () => {
      cancelled = true;
      if (t) clearInterval(t);
    };
  }, [runId, live]);

  if (state === "forbidden") return null;
  if (state === "loading") return <p className="text-muted-foreground">loading trace…</p>;
  if (state === "error" || !data) return <p className="text-muted-foreground">trace unavailable</p>;

  const { run, trace } = data;
  const fmtS = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, "0")}s` : `${s.toFixed(1)}s`);
  return (
    <>
      <div className="mb-3 rounded border border-amber-500/40 bg-amber-500/10 p-2 font-mono text-[11px] leading-5 text-amber-900 dark:text-amber-200" title="This pane: live CMA calls (sessions.retrieve + full events.list), fetched after the page rendered.">
        <div>sausage · cma live · {fetchMs ?? "…"}ms fetch · {trace.eventCount} events</div>
        <div>
          run: {fmtS(trace.wallS)} wall · {trace.modelRequests} model calls · ${(trace.listCostCents / 100).toFixed(2)}
        </div>
        <div className="text-amber-800/80 dark:text-amber-300/70">
          tokens {trace.tokens.in.toLocaleString()} in · {trace.tokens.cacheRead.toLocaleString()} cached · {trace.tokens.out.toLocaleString()} out
        </div>
      </div>
      <dl className="mb-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono">
        <dt className="text-muted-foreground">session</dt>
        <dd><a className="underline" href={trace.traceUrl} target="_blank" rel="noreferrer">{run.cmaSessionId}</a></dd>
        <dt className="text-muted-foreground">status</dt>
        <dd>{trace.status}{trace.stop ? ` (${trace.stop})` : ""}</dd>
        <dt className="text-muted-foreground">cost</dt>
        <dd>${(trace.listCostCents / 100).toFixed(2)} of ${(trace.budgetCents / 100).toFixed(2)}</dd>
        <dt className="text-muted-foreground">agent</dt>
        <dd>{run.cmaAgentId} v{run.cmaAgentVersion}</dd>
        <dt className="text-muted-foreground">skill</dt>
        <dd>{run.cmaSkillVersion ?? "—"}</dd>
      </dl>
      <div className="mb-3 flex flex-wrap gap-2">
        <form action={bumpBudgetAction}>
          <input type="hidden" name="runId" value={run.id} />
          <Button type="submit" size="sm" variant={trace.stop === "budget_reached" ? "default" : "outline"}>
            {trace.stop === "budget_reached" ? "Budget reached — bump +$5" : "Bump budget +$5"}
          </Button>
        </form>
        <RequestUpdate subjectId={subjectId} label="Regenerate" variant="outline" />
      </div>
      <ol className="space-y-1 font-mono">
        {trace.events.map((e) => (
          <li key={e.id} className="grid grid-cols-[3.5rem_1fr] gap-x-2">
            <span className="text-right tabular-nums text-muted-foreground">{e.elapsedS === null ? "" : `+${fmtS(e.elapsedS)}`}</span>
            <span className="min-w-0 break-words">
              <span className={e.type === "agent.custom_tool_use" ? "text-amber-700 dark:text-amber-300" : e.type.startsWith("agent.") ? "text-foreground" : "text-muted-foreground"}>{e.type}</span>
              {e.detail && <span className="text-muted-foreground"> {e.detail}</span>}
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}

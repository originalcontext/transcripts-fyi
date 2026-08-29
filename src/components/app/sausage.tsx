"use client";

import { useEffect, useState } from "react";
import { bumpBudgetAction } from "@/app/s/actions";
import { Button } from "@/components/ui/button";

type Trace = {
  run: { id: string; cmaSessionId: string; cmaAgentId: string; cmaAgentVersion: number };
  trace: {
    status: string;
    stop: string | null;
    listCostCents: number;
    budgetCents: number;
    inputTokens?: number;
    outputTokens?: number;
    events: { id: string; type: string; at: string | null; detail: string }[];
    traceUrl: string;
  };
};

/**
 * "How the sausage was made." Fetched after mount so the page's server render
 * never waits on CMA; admins and non-admins get the same TTFB. Refetches on an
 * interval while the run is live.
 */
export function Sausage({ runId, live }: { runId: string; live: boolean }) {
  const [data, setData] = useState<Trace | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "forbidden" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await fetch(`/api/runs/${runId}/trace`, { cache: "no-store" });
      if (cancelled) return;
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
  return (
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
  );
}

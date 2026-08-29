"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { runSmokeAction } from "@/app/actions";
import type { SmokeInspection } from "@/lib/smoke/session";

type Run = { sessionId: string; startedAt: number; elapsedS: number; result: SmokeInspection | null; error?: string };

export function SmokeRunner({ target }: { target: string }) {
  const router = useRouter();
  const [runs, setRuns] = useState<Run[]>([]);
  const [starting, setStarting] = useState(false);

  async function start() {
    setStarting(true);
    const r = await runSmokeAction();
    setStarting(false);
    if ("error" in r) {
      setRuns((rs) => [{ sessionId: "—", startedAt: Date.now(), elapsedS: 0, result: null, error: r.error }, ...rs]);
      return;
    }
    setRuns((rs) => [{ sessionId: r.sessionId, startedAt: Date.now(), elapsedS: 0, result: null }, ...rs]);
  }

  // Poll every open run until it is done. Short requests, no long-lived
  // connection — the same shape the webhook path relies on.
  useEffect(() => {
    const open = runs.filter((r) => !r.error && !r.result?.done);
    if (open.length === 0) return;
    const t = setTimeout(async () => {
      for (const run of open) {
        const res = await fetch(`/api/smoke/${run.sessionId}`, { cache: "no-store" });
        const body = (await res.json()) as SmokeInspection | { error: string };
        setRuns((rs) =>
          rs.map((r) =>
            r.sessionId !== run.sessionId
              ? r
              : "error" in body
                ? { ...r, error: body.error }
                : { ...r, result: body, elapsedS: Math.round((Date.now() - r.startedAt) / 1000) },
          ),
        );
        if ("done" in body && body.done) router.refresh();
      }
    }, 2000);
    return () => clearTimeout(t);
  }, [runs, router]);

  return (
    <section className="space-y-4">
      <button
        onClick={start}
        disabled={starting}
        className="rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {starting ? "starting…" : `Run smoke (${target})`}
      </button>

      {runs.map((run) => (
        <div key={run.sessionId + run.startedAt} className="rounded border border-neutral-300 p-3 text-sm dark:border-neutral-700">
          <div className="flex items-center justify-between font-mono text-xs">
            <span>{run.sessionId}</span>
            <span>
              {run.error
                ? "error"
                : !run.result
                  ? "creating…"
                  : run.result.done
                    ? run.result.pass
                      ? `PASS · $${(run.result.listCostCents / 100).toFixed(2)}`
                      : `FAIL · ${run.result.stop ?? run.result.status}`
                    : `${run.result.status}${run.result.stop ? ` (${run.result.stop})` : ""} · ${run.elapsedS}s`}
            </span>
          </div>
          {run.error && <p className="mt-2 text-red-600">{run.error}</p>}
          {run.result && (
            <ul className="mt-2 space-y-1 font-mono text-xs">
              {run.result.checks.map((c) => (
                <li key={c.label} className={c.ok ? "text-green-700 dark:text-green-400" : "text-neutral-500"}>
                  {c.ok ? "PASS" : run.result!.done ? "FAIL" : "····"} {c.label}
                </li>
              ))}
              <li>
                <a className="underline" href={run.result.traceUrl} target="_blank" rel="noreferrer">
                  trace
                </a>
              </li>
            </ul>
          )}
          {run.result?.summary && (
            <div className="mt-3 border-t border-neutral-200 pt-3 dark:border-neutral-800">
              <div className="mb-1 font-medium">
                {run.result.summary.symbol} · {run.result.summary.period}
              </div>
              <pre className="whitespace-pre-wrap font-sans text-sm">{run.result.summary.summary}</pre>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

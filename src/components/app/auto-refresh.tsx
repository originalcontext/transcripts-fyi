"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * While a run works, poll a tiny Postgres-only status route every `ms` and
 * re-render the page only when status or the latest artifact changes —
 * instead of re-rendering (and re-shipping the ~50KB artifact) every tick.
 */
export function AutoRefresh({ active, subjectId, ms = 5000 }: { active: boolean; subjectId: string; ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    let last: string | null = null;
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/subjects/${subjectId}/status`, { cache: "no-store" });
        if (!res.ok || stopped) return;
        const now = JSON.stringify(await res.json());
        if (last !== null && now !== last) router.refresh();
        last = now;
      } catch {}
    };
    const t = setInterval(tick, ms);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [active, subjectId, ms, router]);
  return null;
}

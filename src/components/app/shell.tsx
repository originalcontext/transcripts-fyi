import Link from "next/link";

import { logoutAction } from "@/app/login/actions";
import { AddSubject } from "@/components/app/add-subject";
import { MobileNav } from "@/components/app/mobile-nav";
import { UniverseNav } from "@/components/app/universe-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { deployTarget } from "@/lib/anthropic";
import { listUniverse } from "@/lib/distill/queries";

/**
 * App chrome. `hotPathMs` is the page's own Postgres time; the shell adds its
 * universe query and shows the total in the green bar across the top.
 */
type Universe = Awaited<ReturnType<typeof listUniverse>>;

/**
 * App chrome. The page passes the universe it already fetched (one round for
 * everything) and its Postgres time; pages without one let the shell fetch.
 */
async function timedUniverse(universe?: Universe) {
  if (universe) return { list: universe, ms: 0 };
  const t0 = performance.now();
  const list = await listUniverse();
  return { list, ms: performance.now() - t0 };
}

export async function Shell({ current, universe, hotPathMs = 0, children }: { current?: string; universe?: Universe; hotPathMs?: number; children: React.ReactNode }) {
  const { list, ms } = await timedUniverse(universe);
  const totalMs = Math.round(hotPathMs + ms);
  const target = deployTarget();
  const account = (
    <form action={logoutAction}>
      <Button variant="link" size="sm" className="h-auto p-0 text-xs text-muted-foreground">log out</Button>
    </form>
  );
  const sidebar = (
    <div className="space-y-3">
      <AddSubject />
      <UniverseNav universe={list} current={current} />
    </div>
  );

  return (
    <div className="flex h-dvh flex-col">
      <div
        className="flex items-center justify-center gap-2 bg-emerald-500/10 px-3 py-0.5 font-mono text-[11px] text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-400"
        title="This render: Postgres only. Never waits on CMA."
      >
        hot path · {totalMs}ms · $0/view
      </div>
      <header className="flex items-center justify-between gap-2 border-b px-2 py-1.5 md:px-4 md:py-2">
        <div className="flex min-w-0 items-center gap-2 md:gap-3">
          <MobileNav>
            <div className="space-y-4">
              {sidebar}
              {account}
            </div>
          </MobileNav>
          <Link href="/" className="truncate font-semibold">transcripts.fyi</Link>
          {target === "dev" && <Badge variant="outline">{target}</Badge>}
        </div>
        <div className="hidden md:block">{account}</div>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-56 shrink-0 overflow-y-auto border-r p-2 md:block">{sidebar}</aside>
        {children}
      </div>
    </div>
  );
}

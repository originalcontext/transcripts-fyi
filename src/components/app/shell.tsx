import Link from "next/link";

import { logoutAction } from "@/app/login/actions";
import { AddSubject } from "@/components/app/add-subject";
import { MobileNav } from "@/components/app/mobile-nav";
import { UniverseNav } from "@/components/app/universe-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { deployTarget } from "@/lib/anthropic";
import { listUniverse } from "@/lib/distill/queries";

export async function Shell({ current, children }: { current?: string; children: React.ReactNode }) {
  const universe = await listUniverse();
  const target = deployTarget();
  const account = (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <Link href="/smoke" className="underline">smoke</Link>
      <form action={logoutAction}>
        <Button variant="link" size="sm" className="h-auto p-0 text-xs text-muted-foreground">log out</Button>
      </form>
    </div>
  );

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center justify-between gap-2 border-b px-2 py-1.5 md:px-4 md:py-2">
        <div className="flex min-w-0 items-center gap-2 md:gap-3">
          <MobileNav>
            <div className="space-y-4">
              <UniverseNav universe={universe} current={current} />
              {account}
            </div>
          </MobileNav>
          <Link href="/" className="truncate font-semibold">transcripts.fyi</Link>
          <Badge variant="outline">{target}</Badge>
        </div>
        <div className="flex items-center gap-3">
          <AddSubject />
          <div className="hidden md:block">{account}</div>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-48 shrink-0 overflow-y-auto border-r p-2 md:block">
          <UniverseNav universe={universe} current={current} />
        </aside>
        {children}
      </div>
    </div>
  );
}

import Link from "next/link";

import { logoutAction } from "@/app/login/actions";
import { AddSubject } from "@/components/app/add-subject";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { deployTarget } from "@/lib/anthropic";
import { listUniverse } from "@/lib/distill/queries";
import { cn } from "@/lib/utils";

export async function Shell({ current, children }: { current?: string; children: React.ReactNode }) {
  const universe = await listUniverse();
  const target = deployTarget();
  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-3">
          <Link href="/" className="font-semibold">transcripts.fyi</Link>
          <Badge variant="outline">{target}</Badge>
        </div>
        <div className="flex items-center gap-3">
          <AddSubject />
          <Link href="/smoke" className="text-xs text-muted-foreground underline">smoke</Link>
          <form action={logoutAction}>
            <Button variant="link" size="sm" className="h-auto p-0 text-xs text-muted-foreground">log out</Button>
          </form>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="w-48 shrink-0 overflow-y-auto border-r p-2">
          <div className="px-2 pb-1 text-xs font-medium text-muted-foreground">Universe</div>
          {universe.length === 0 && <p className="px-2 text-xs text-muted-foreground">empty — add a ticker</p>}
          <ul className="space-y-0.5">
            {universe.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/s/${s.key}`}
                  className={cn(
                    "block rounded px-2 py-1 font-mono text-sm hover:bg-accent",
                    s.key === current && "bg-accent",
                    s.working && !s.hasArtifact && "text-muted-foreground/60 italic",
                  )}
                  title={s.working ? "working…" : undefined}
                >
                  {s.key}
                </Link>
              </li>
            ))}
          </ul>
        </aside>
        {children}
      </div>
    </div>
  );
}

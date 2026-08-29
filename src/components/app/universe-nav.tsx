import Link from "next/link";

import { cn } from "@/lib/utils";

export type UniverseEntry = { id: string; key: string; hasArtifact: boolean; working: boolean };

/** The universe list. Rendered in the desktop sidebar and inside the mobile sheet. */
export function UniverseNav({ universe, current }: { universe: UniverseEntry[]; current?: string }) {
  return (
    <nav>
      <div className="px-2 pb-1 text-xs font-medium text-muted-foreground">Universe</div>
      {universe.length === 0 && <p className="px-2 text-xs text-muted-foreground">empty — add a ticker</p>}
      <ul className="space-y-0.5">
        {universe.map((s) => (
          <li key={s.id}>
            <Link
              href={`/s/${s.key}`}
              className={cn(
                "block rounded px-2 py-1.5 font-mono text-sm hover:bg-accent md:py-1",
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
    </nav>
  );
}

import Link from "next/link";

import tickers from "@/data/tickers.json";
import { asTickerEntries } from "@/lib/tickers";
import { cn } from "@/lib/utils";

export type UniverseEntry = { id: string; key: string; hasArtifact: boolean; working: boolean };

/** ticker → company name from the static top-3000 list. Server-only; never shipped to the client. */
const NAMES = new Map<string, string>(asTickerEntries(tickers.tickers).map(([t, n]) => [t, n]));

/** The universe list. Rendered in the desktop sidebar and inside the mobile sheet. */
export function UniverseNav({ universe, current }: { universe: UniverseEntry[]; current?: string }) {
  return (
    <nav>
      <div className="px-2 pb-1 text-xs font-medium text-muted-foreground">Universe</div>
      {universe.length === 0 && <p className="px-2 text-xs text-muted-foreground">empty — add a ticker</p>}
      <ul className="space-y-0.5">
        {universe.map((s) => {
          const name = NAMES.get(s.key);
          const pending = s.working && !s.hasArtifact;
          return (
            <li key={s.id}>
              <Link
                href={`/s/${s.key}`}
                className={cn(
                  "flex min-w-0 flex-col rounded-md px-2 py-1.5 leading-tight hover:bg-accent",
                  s.key === current && "bg-accent",
                  pending && "text-muted-foreground/60 italic",
                )}
                title={s.working ? "working…" : name}
              >
                <span className="truncate font-mono text-sm">{s.key}</span>
                {name && <span className={cn("truncate text-xs text-muted-foreground", pending && "text-muted-foreground/60")}>{name}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

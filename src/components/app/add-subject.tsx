"use client";

import { Command as CommandPrimitive } from "cmdk";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { addSubjectAction } from "@/app/s/actions";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";

type Entry = readonly [ticker: string, name: string];
let cache: Entry[] | null = null;
/** Static top-3000 list, loaded on first focus so it never rides in the initial bundle. */
async function loadTickers(): Promise<Entry[]> {
  cache ??= (await import("@/data/tickers.json")).default.tickers as unknown as Entry[];
  return cache;
}

function search(list: Entry[], raw: string): Entry[] {
  const q = raw.trim().toUpperCase();
  if (!q) return [];
  const ql = raw.trim().toLowerCase();
  const exact: Entry[] = [], prefix: Entry[] = [], name: Entry[] = [];
  for (const e of list) {
    if (e[0] === q) exact.push(e);
    else if (e[0].startsWith(q)) prefix.push(e);
    else if (e[1].toLowerCase().includes(ql)) name.push(e);
    if (exact.length + prefix.length + name.length > 40) break;
  }
  return [...exact, ...prefix, ...name].slice(0, 8);
}

/**
 * "Add to universe": a wordwheel over the static ticker list — ticker or
 * company name → ticker. The results render in a portal (Popover) so the
 * narrow sidebar never clips or widens; `Command` wraps both the input and
 * the portaled list so cmdk's ArrowUp/Down/Enter keep working across them.
 */
export function AddSubject() {
  const router = useRouter();
  const [state, action, pending] = useActionState(addSubjectAction, undefined);
  const [query, setQuery] = useState("");
  const [list, setList] = useState<Entry[] | null>(null);
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const results = list ? search(list, query) : [];
  const showResults = open && query.trim().length > 0;

  useEffect(() => {
    if (state?.key) {
      toast(`${state.key} added — report coming soon`, { description: "Distilling the last 8 earnings calls." });
      router.push(`/s/${state.key}`);
    } else if (state?.error) toast.error(state.error);
  }, [state, router]);

  const choose = (ticker: string) => {
    setQuery(ticker);
    setOpen(false);
    // Let the controlled input take the value, then submit the form.
    queueMicrotask(() => formRef.current?.requestSubmit());
  };

  return (
    <form ref={formRef} action={action} onSubmit={() => setOpen(false)}>
      <Popover open={showResults} onOpenChange={setOpen}>
        <Command shouldFilter={false} label="Add a company to the universe" className="overflow-visible bg-transparent p-0">
          <PopoverAnchor asChild>
            <div ref={anchorRef} className="flex items-center gap-1.5">
              <CommandPrimitive.Input asChild value={query} onValueChange={(v) => { setQuery(v); setOpen(true); }}>
                <Input
                  name="key"
                  onFocus={() => {
                    setOpen(true);
                    if (!list) loadTickers().then(setList);
                  }}
                  onBlur={() => setOpen(false)}
                  onKeyDown={(e) => {
                    // cmdk swallows Enter; let it through when there is nothing to pick so raw input submits.
                    if (e.key === "Enter" && !(showResults && results.length > 0)) e.stopPropagation();
                  }}
                  placeholder="ticker or company"
                  className="h-8 uppercase placeholder:normal-case"
                />
              </CommandPrimitive.Input>
              <Button type="submit" size="sm" disabled={pending || !query.trim()}>
                {pending ? "…" : "Add"}
              </Button>
            </div>
          </PopoverAnchor>
          <PopoverContent
            align="start"
            sideOffset={4}
            className="w-[min(20rem,calc(100vw-1rem))] p-0"
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}
            onInteractOutside={(e) => {
              // Clicking back into the input/row is not "outside".
              if (anchorRef.current?.contains(e.target as Node)) e.preventDefault();
            }}
          >
            <CommandList>
              {!list ? (
                <CommandEmpty>loading…</CommandEmpty>
              ) : results.length === 0 ? (
                <CommandEmpty>no match — press Add to try the ticker anyway</CommandEmpty>
              ) : (
                <CommandGroup>
                  {results.map(([t, n]) => (
                    <CommandItem key={t} value={t} onSelect={() => choose(t)} onMouseDown={(e) => e.preventDefault()}>
                      <span className="w-16 shrink-0 font-mono">{t}</span>
                      <span className="truncate text-muted-foreground">{n}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </PopoverContent>
        </Command>
      </Popover>
    </form>
  );
}

"use client";

import { PanelRightCloseIcon, PanelRightOpenIcon } from "lucide-react";
import { useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const STORAGE_KEY = "tfyi:sausage-open";

// Per-viewer "drawer open" preference in localStorage, exposed as an external
// store so the server render (always open) and the client agree without a
// setState-in-effect. Everything is try/catch'd: storage may be unavailable.
const listeners = new Set<() => void>();
const readOpen = () => {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
};
const writeOpen = (v: boolean) => {
  try {
    localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
  } catch {}
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/**
 * Main area + the retractable sausage panel.
 *  - md and up: an inline right panel, toggled from the header; state remembered per viewer.
 *  - below md: the same panel as a right-hand sheet.
 * `panel` is null for non-admins, in which case there is no toggle at all.
 */
export function SausageLayout({ header, panel, children }: { header: React.ReactNode; panel: React.ReactNode | null; children: React.ReactNode }) {
  const open = useSyncExternalStore(subscribe, readOpen, () => true);
  const toggle = () => writeOpen(!open);

  const toggleButton = panel && (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label={open ? "Hide trace" : "Show trace"} title="How the sausage was made" className="text-amber-700 dark:text-amber-400">
      {open ? <PanelRightCloseIcon /> : <PanelRightOpenIcon />}
    </Button>
  );

  const panelChrome = (
    <>
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium text-amber-800 dark:text-amber-300">How the sausage was made</span>
        <span className="font-mono text-[10px] text-amber-700/80 dark:text-amber-400/80">admin · live from CMA</span>
      </div>
      {panel}
    </>
  );

  return (
    <>
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5 text-sm md:px-4">
          <div className="min-w-0 flex-1">{header}</div>
          {toggleButton}
        </div>
        {children}
      </main>

      {panel && open && (
        <aside className="hidden w-[26rem] shrink-0 overflow-y-auto border-l border-amber-500/30 bg-amber-500/[0.04] p-3 text-xs md:block dark:bg-amber-400/[0.05]">
          {panelChrome}
        </aside>
      )}

      {panel && (
        <div className="md:hidden">
          <Sheet open={open} onOpenChange={writeOpen}>
            <SheetContent side="right" className="w-[90vw] overflow-y-auto border-amber-500/30 bg-amber-500/[0.04] p-3 text-xs dark:bg-amber-400/[0.05]">
              <SheetHeader className="p-0">
                <SheetTitle className="sr-only">How the sausage was made</SheetTitle>
                <SheetDescription className="sr-only">Live trace of the agent session</SheetDescription>
              </SheetHeader>
              {panelChrome}
            </SheetContent>
          </Sheet>
        </div>
      )}
    </>
  );
}

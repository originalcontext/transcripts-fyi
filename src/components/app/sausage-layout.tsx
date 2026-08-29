"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";

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
 * Main area + the sausage panel.
 *
 * The panel is a glass sheet that overlays the RIGHT side of the middle pane
 * only — never the nav or header, and nothing behind it is dimmed. It is open
 * by default. A full-height amber rail on the pane's right edge is the toggle;
 * when closed, only the rail remains. Same mechanism at every width; the panel
 * just gets narrower on small screens. `panel` is null for non-admins → no rail.
 */
export function SausageLayout({ header, panel, children }: { header: React.ReactNode; panel: React.ReactNode | null; children: React.ReactNode }) {
  const open = useSyncExternalStore(subscribe, readOpen, () => true);

  return (
    <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b px-3 py-1.5 text-sm md:px-4">
        <div className="min-w-0 flex-1">{header}</div>
      </div>
      {children}

      {panel && (
        <div
          className={cn(
            "absolute inset-y-0 right-0 flex transition-transform duration-200 ease-out",
            // closed: slide the panel off to the right, leaving just the rail
            !open && "translate-x-[calc(100%-1.5rem)]",
          )}
        >
          <button
            type="button"
            onClick={() => writeOpen(!open)}
            aria-expanded={open}
            aria-label={open ? "Hide how the sausage was made" : "Show how the sausage was made"}
            className="flex w-6 shrink-0 cursor-pointer flex-col items-center justify-center gap-3 border-l border-amber-600/40 bg-amber-400 text-amber-950 hover:bg-amber-300 dark:bg-amber-500 dark:hover:bg-amber-400"
          >
            {open ? <ChevronRightIcon className="size-4" /> : <ChevronLeftIcon className="size-4" />}
            <span className="font-mono text-[10px] font-medium uppercase tracking-widest [writing-mode:vertical-rl]">sausage</span>
            {open ? <ChevronRightIcon className="size-4" /> : <ChevronLeftIcon className="size-4" />}
          </button>

          <aside
            aria-hidden={!open}
            className="w-[min(90vw,26rem)] overflow-y-auto border-l border-amber-500/30 bg-amber-50/80 p-3 text-xs shadow-xl backdrop-blur-md dark:bg-amber-950/60"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="font-medium text-amber-800 dark:text-amber-300">How the sausage was made</span>
              <span className="font-mono text-[10px] text-amber-700/80 dark:text-amber-400/80">admin · live from CMA</span>
            </div>
            {panel}
          </aside>
        </div>
      )}
    </main>
  );
}

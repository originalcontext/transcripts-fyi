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
 * The panel is a glass sheet that overlays the RIGHT side of the middle pane's
 * content area only — never the nav, the header, or the pane's own status row,
 * and nothing behind it is dimmed. It is open
 * by default. A full-height amber rail on the pane's right edge is the toggle;
 * when closed, only the rail remains. Same mechanism at every width; the panel
 * just gets narrower on small screens. `panel` is null for non-admins → no rail.
 */
export function SausageLayout({ header, panel, children }: { header: React.ReactNode; panel: React.ReactNode | null; children: React.ReactNode }) {
  const open = useSyncExternalStore(subscribe, readOpen, () => true);

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b px-3 py-1.5 text-sm md:px-4">
        <div className="min-w-0 flex-1">{header}</div>
      </div>

      {/* The overlay lives here, below the header row, so the status line is never covered. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {children}

        {panel && (
        <div
          className={cn(
            "absolute inset-y-2 right-0 flex transition-transform duration-300 [transition-timing-function:cubic-bezier(.2,.8,.2,1)]",
            // closed: slide the panel off to the right, leaving just the rail
            !open && "translate-x-[calc(100%-1.5rem)]",
          )}
        >
          <button
            type="button"
            onClick={() => writeOpen(!open)}
            aria-expanded={open}
            aria-label={open ? "Hide how the sausage was made" : "Show how the sausage was made"}
            className="flex w-6 shrink-0 cursor-pointer flex-col items-center justify-center gap-3 rounded-l-2xl border border-r-0 border-white/40 bg-amber-400/70 text-amber-950 shadow-lg backdrop-blur-xl backdrop-saturate-150 transition-colors hover:bg-amber-300/80 dark:border-white/15 dark:bg-amber-500/60 dark:text-amber-50 dark:hover:bg-amber-400/70"
          >
            {open ? <ChevronRightIcon className="size-4" /> : <ChevronLeftIcon className="size-4" />}
            <span className="font-mono text-[10px] font-medium uppercase tracking-widest [writing-mode:vertical-rl]">sausage</span>
            {open ? <ChevronRightIcon className="size-4" /> : <ChevronLeftIcon className="size-4" />}
          </button>

          <aside
            aria-hidden={!open}
            className="relative w-[min(90vw,26rem)] overflow-y-auto border-y border-l border-white/50 bg-white/35 p-3 text-xs shadow-2xl shadow-black/20 backdrop-blur-2xl backdrop-saturate-150 before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-24 before:bg-gradient-to-b before:from-white/40 before:to-transparent dark:border-white/10 dark:bg-neutral-900/35 dark:before:from-white/10"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="font-medium text-amber-800 dark:text-amber-300">How the sausage was made</span>
              <span className="font-mono text-[10px] text-amber-700/80 dark:text-amber-400/80">admin · live from CMA</span>
            </div>
            {panel}
          </aside>
        </div>
        )}
      </div>
    </main>
  );
}

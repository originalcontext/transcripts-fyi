"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";

const noop = () => () => {};
/** false during SSR/hydration, true once on the client — so the iframe is created with onLoad already attached. */
const useMounted = () => useSyncExternalStore(noop, () => true, () => false);

/**
 * The explainer iframe. Created client-side and kept invisible until its
 * document has loaded (with a safety timeout), over a dark wrapper, so the
 * browser's default white never paints and a missed load event can't hide it.
 */
export function ArtifactFrame({ title, srcDoc }: { title: string; srcDoc: string }) {
  const mounted = useMounted();
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!mounted || loaded) return;
    const t = setTimeout(() => setLoaded(true), 1500);
    return () => clearTimeout(t);
  }, [mounted, loaded]);

  if (!mounted) return <div className="flex-1 bg-[#0a0a0a]" />;
  return (
    <iframe
      title={title}
      srcDoc={srcDoc}
      sandbox="allow-scripts"
      onLoad={() => setLoaded(true)}
      className={cn("h-full w-full flex-1 bg-[#0a0a0a] transition-opacity duration-150", loaded ? "opacity-100" : "opacity-0")}
    />
  );
}

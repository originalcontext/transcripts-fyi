"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

/**
 * The explainer iframe. Kept invisible until its document has loaded so the
 * browser's default white never paints; the wrapper behind it is dark.
 */
export function ArtifactFrame({ title, srcDoc }: { title: string; srcDoc: string }) {
  const [loaded, setLoaded] = useState(false);
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

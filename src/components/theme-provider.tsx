"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/** Dark only: the explainers, share cards and favicon all commit to #0a0a0a, and light didn't hold up on mobile. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" forcedTheme="dark" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
      {children}
    </NextThemesProvider>
  );
}

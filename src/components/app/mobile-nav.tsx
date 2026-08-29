"use client";

import { MenuIcon } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

/** Below md: the universe + account links live in a left sheet. Closes on navigation. */
export function MobileNav({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [openedAt, setOpenedAt] = useState(pathname);
  // Close when the route changes (state adjusted during render, per React docs).
  if (open && openedAt !== pathname) {
    setOpen(false);
    setOpenedAt(pathname);
  }
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setOpenedAt(pathname);
      }}
    >
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open universe">
          <MenuIcon />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 p-3">
        <SheetHeader className="p-0 pb-2">
          <SheetTitle className="text-base">transcripts.fyi</SheetTitle>
          <SheetDescription className="sr-only">Universe and account</SheetDescription>
        </SheetHeader>
        {children}
      </SheetContent>
    </Sheet>
  );
}

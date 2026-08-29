"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { toast } from "sonner";

import { addSubjectAction } from "@/app/s/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AddSubject() {
  const router = useRouter();
  const [state, action, pending] = useActionState(addSubjectAction, undefined);

  useEffect(() => {
    if (state?.key) {
      toast(`${state.key} added — report coming soon`, { description: "Distilling the last 8 earnings calls." });
      router.push(`/s/${state.key}`);
    } else if (state?.error) toast.error(state.error);
  }, [state, router]);

  return (
    <form action={action} className="flex items-center gap-2">
      <Input name="key" placeholder="ticker" className="w-20 uppercase md:w-28" autoComplete="off" spellCheck={false} />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "adding…" : <><span className="md:hidden">Add</span><span className="hidden md:inline">Add to universe</span></>}
      </Button>
    </form>
  );
}

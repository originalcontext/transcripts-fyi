"use client";

import { useFormStatus } from "react-dom";

import { regenerateSubjectAction } from "@/app/s/actions";
import { Button } from "@/components/ui/button";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="link" size="sm" disabled={pending} className="h-auto p-0 text-xs">
      {pending ? "Requesting…" : "Request update"}
    </Button>
  );
}

/** Re-distills the subject on the current skill/agent. Submits straight away; admin-gated server-side. */
export function RequestUpdate({ subjectId }: { subjectId: string }) {
  return (
    <form action={regenerateSubjectAction} className="inline-flex">
      <input type="hidden" name="subjectId" value={subjectId} />
      <Submit />
    </form>
  );
}

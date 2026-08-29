"use client";

import { useActionState } from "react";

import { regenerateSubjectAction } from "@/app/s/actions";
import { Button } from "@/components/ui/button";

/**
 * Ends the subject's live run and starts a fresh one on the current
 * skill/agent. Admin-only server side; capped at ten regenerations per
 * subject. Submits immediately — no dialog, by decision.
 */
export function RequestUpdate({
  subjectId,
  label = "Request update",
  variant = "link",
}: {
  subjectId: string;
  label?: string;
  variant?: "link" | "outline";
}) {
  const [state, action, pending] = useActionState(regenerateSubjectAction, undefined);
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="subjectId" value={subjectId} />
      <Button type="submit" size="sm" variant={variant} disabled={pending} className={variant === "link" ? "h-auto p-0 text-xs" : undefined}>
        {pending ? "Requesting…" : label}
      </Button>
      {state?.error && <span className="text-xs text-destructive">{state.error}</span>}
    </form>
  );
}

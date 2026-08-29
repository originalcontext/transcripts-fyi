"use client";

import { useActionState } from "react";
import { loginAction } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm({ next, invite }: { next: string; invite: string }) {
  const [state, action, pending] = useActionState(loginAction, undefined);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="next" value={next} />
      <div className="space-y-1.5">
        <Label htmlFor="code">Invite code</Label>
        <Input
          id="code"
          name="code"
          defaultValue={invite}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          placeholder="enter invite code"
        />
      </div>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "…" : "Enter"}
      </Button>
    </form>
  );
}

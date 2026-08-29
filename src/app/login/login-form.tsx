"use client";

import { useActionState } from "react";

import { loginAction } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm({ next, invite }: { next: string; invite: string }) {
  const [state, action, pending] = useActionState(loginAction, undefined);
  const error = state?.error;
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <div className="space-y-2">
        <Label htmlFor="code">Invite code</Label>
        <Input
          id="code"
          name="code"
          defaultValue={invite}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          placeholder="Paste your invite code"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "code-error" : undefined}
        />
        {error && (
          <p id="code-error" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        Enter
      </Button>
    </form>
  );
}

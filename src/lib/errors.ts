/** An error whose message is safe and useful to show the user. Anything else is logged and generic. */
export class UserError extends Error {
  readonly user = true;
}

export function userMessage(err: unknown, fallback = "Something went wrong. Try again in a minute."): string {
  return err instanceof UserError ? err.message : fallback;
}

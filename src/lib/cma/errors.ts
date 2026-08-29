/** True only when the API says the resource does not exist — never for 429/5xx/network. */
export function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && "status" in err && (err as { status?: unknown }).status === 404;
}

import { anthropic, deployTarget } from "@/lib/anthropic";
import { db, schema } from "@/lib/db";
import { settlePingPongSession } from "@/lib/smoke/ping-pong";

/**
 * Receiver for Anthropic Managed Agents webhooks.
 *
 * Registered in Console → Manage → Webhooks as exactly
 *   prod:  https://transcripts.fyi/webhook
 *   dev:   https://<ngrok-host>/webhook      (separate endpoint, own secret)
 * (https, no trailing slash — a 3xx of any kind auto-disables the endpoint).
 *
 * Payloads are thin (event type + resource id); we fetch the resource and
 * decide from its state. Both prod and dev receive every event, so handlers
 * must check the session's `metadata.target` before acting.
 */
export async function POST(request: Request) {
  if (!anthropic.webhookKey) {
    console.error("webhook: ANTHROPIC_WEBHOOK_SIGNING_KEY is not set");
    return new Response("webhook signing key not configured", { status: 500 });
  }

  // Raw bytes — re-serialising the JSON would break the signature.
  const body = await request.text();
  const headers = Object.fromEntries(request.headers.entries());

  let event: ReturnType<typeof anthropic.beta.webhooks.unwrap>;
  try {
    event = anthropic.beta.webhooks.unwrap(body, { headers });
  } catch {
    return new Response("invalid signature", { status: 400 });
  }

  const log = { id: event.id, type: event.data.type, resource: event.data.id };

  // Dedupe on event.id (retries reuse it). Each deployment records its own
  // copy — dev and prod both receive every event. Handlers stay idempotent
  // against the session's event log regardless, so this is belt-and-braces.
  const inserted = await db
    .insert(schema.webhookEvents)
    .values({ id: event.id, type: event.data.type, resource: event.data.id, target: deployTarget() })
    .onConflictDoNothing()
    .returning({ id: schema.webhookEvents.id });
  if (inserted.length === 0) {
    console.log("webhook", { ...log, action: "duplicate" });
    return new Response(null, { status: 204 });
  }
  switch (event.data.type) {
    case "session.status_idled":
    case "session.requires_action": {
      const result = await settlePingPongSession(event.data.id);
      console.log("webhook", { ...log, ...result });
      break;
    }
    default:
      console.log("webhook", log);
  }

  return new Response(null, { status: 204 });
}

import Anthropic from "@anthropic-ai/sdk";

/**
 * Receiver for Anthropic Managed Agents webhooks.
 *
 * Register in Console → Manage → Webhooks as exactly
 *   https://transcripts-fyi.vercel.app/webhook
 * (https, no trailing slash — a 3xx of any kind auto-disables the endpoint).
 *
 * Payloads are thin (event type + resource id). Nothing is acted on yet;
 * this exists so the endpoint is live and verifiable before we subscribe.
 */

// Reads ANTHROPIC_WEBHOOK_SIGNING_KEY from the environment.
const client = new Anthropic();

export async function POST(request: Request) {
  if (!client.webhookKey) {
    console.error("webhook: ANTHROPIC_WEBHOOK_SIGNING_KEY is not set");
    return new Response("webhook signing key not configured", { status: 500 });
  }

  // Raw bytes — re-serialising the JSON would break the signature.
  const body = await request.text();
  const headers = Object.fromEntries(request.headers.entries());

  let event: Anthropic.Beta.BetaWebhookEvent;
  try {
    event = client.beta.webhooks.unwrap(body, { headers });
  } catch {
    return new Response("invalid signature", { status: 400 });
  }

  // TODO: dedupe on event.id — retries reuse it — once we have a store.
  console.log("webhook", {
    id: event.id,
    type: event.data.type,
    resource: event.data.id,
    at: event.created_at,
  });

  return new Response(null, { status: 204 });
}

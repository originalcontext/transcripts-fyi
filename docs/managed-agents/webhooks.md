# Webhooks

Read when you want push notifications of session state instead of holding an SSE stream open.

Anthropic POSTs to your HTTPS endpoint when a Managed Agents resource changes state. Payloads are **thin** (event type + resource IDs only) — on receipt, **fetch the resource** for current state. Every delivery is HMAC-signed.

> **Direction matters.** This covers *Anthropic → you* notifications. It does **not** cover *third-party → you* webhooks that *trigger* a session (e.g. a GitHub push handler that calls `sessions.create()`) — that's ordinary application code with no Anthropic-specific wire format.

## Register an endpoint (Console only)

Console → **Manage → Webhooks**. **There is no programmatic endpoint-management API yet.** Secret rotation is supported from the same page.

| Field | Constraint |
|---|---|
| URL | HTTPS on port 443, publicly resolvable hostname |
| Event types | Subscribe per `data.type` — an endpoint receives only the types it is subscribed to |
| Signing secret | `whsec_`-prefixed, 32 bytes, **shown once at creation** |

## Verify the signature

Every delivery carries `webhook-id`, `webhook-timestamp`, and `webhook-signature` headers. **Use the SDK's `client.beta.webhooks.unwrap()`** — it verifies the signature, rejects payloads more than ~5 minutes old, and returns the parsed event. It reads the `whsec_` secret from `ANTHROPIC_WEBHOOK_SIGNING_KEY`.

**Pass the raw request body** — frameworks that re-serialize JSON (Express `.json()`, Flask `.get_json()`) change the bytes and break the MAC. Don't hand-roll verification against a single `X-Webhook-Signature` header; that is not the wire format.

```python
import anthropic
from flask import Flask, request

client = anthropic.Anthropic()  # reads ANTHROPIC_WEBHOOK_SIGNING_KEY from env
app = Flask(__name__)


@app.route("/webhook", methods=["POST"])
def webhook():
    try:
        event = client.beta.webhooks.unwrap(
            request.get_data(as_text=True),
            headers=dict(request.headers),
        )
    except Exception:
        return "invalid signature", 400

    if event.id in seen_event_ids:  # dedupe retries - id is per-event, not per-delivery
        return "", 204
    seen_event_ids.add(event.id)

    match event.data.type:
        case "session.status_idled":
            session = client.beta.sessions.retrieve(event.data.id)
            notify_user(session)
        case "vault_credential.refresh_failed":
            alert_oncall(event.data.id)

    return "", 204
```

> In a Next.js Route Handler, read the raw body with `await request.text()` (not `await request.json()`) before calling `unwrap()`.

## Payload envelope

```json
{
  "type": "event",
  "id": "whe_9d5c1f7e...",
  "created_at": "2026-03-18T14:05:22Z",
  "data": {
    "type": "session.status_idled",
    "id": "session_01XYZ...",
    "organization_id": "8a3d2f1e-...",
    "workspace_id": "c7b0e4d9-..."
  }
}
```

Switch on `data.type`, fetch the resource by `data.id`, return any **2xx** to acknowledge. `created_at` is when the *event occurred*; the `webhook-timestamp` header is the clock for the *delivery attempt*.

The top-level `id` equals the `webhook-id` header and is per **event**, not per delivery — every retry carries it unchanged. **Dedupe on it.**

## Supported `data.type` values

### Session

| `data.type` | Fires when |
|---|---|
| `session.status_scheduled` | Session created and ready to accept events |
| `session.status_run_started` | Agent execution kicked off (every transition to `running`) |
| `session.status_idled` | Agent awaiting input — or paused at its budget. Payload is thin: list the session's events and check the latest `session.status_idle` event's `stop_reason` (**the session object itself has no `stop_reason` field**). |
| `session.status_rescheduled` | Transient error; retrying automatically |
| `session.status_terminated` | Session ended — **on completion or on error**, not error-only |
| `session.thread_created` | Multiagent: new subagent thread, or an advisor consultation |
| `session.thread_idled` | **Child threads only**: a subagent thread awaiting input, or paused at the cap |
| `session.thread_terminated` | **Child threads only** — the primary thread's end surfaces as `session.status_terminated` |
| `session.outcome_evaluation_ended` | Outcome grader finished one iteration |
| `session.updated` | Session properties changed |
| `session.deleted` | Permanently deleted — no object left to fetch; treat the event as final |

### Vault

`vault.created`, `vault.archived`, `vault.deleted` (also fires `vault_credential.deleted` per credential), `vault_credential.created`, `vault_credential.archived`, `vault_credential.deleted`, `vault_credential.refresh_failed` (MCP OAuth refresh failed).

### Agent

`agent.created`, `agent.updated` (**only when a new version is published** — updates that don't create a version don't fire), `agent.archived`, `agent.deleted`.

### Deployment

`deployment.created`, `deployment.updated`, `deployment.paused` (by request, **or automatically when a scheduled run fails with a non-recoverable error** — archived agent, missing environment; recoverable failures including rate limits do **not** auto-pause), `deployment.unpaused`, `deployment.archived`, `deployment.deleted`.

`deployment_run.started` / `.succeeded` / `.failed` — **scheduled runs only; manual runs emit nothing.** `.succeeded` and `.failed` carry the same `data.id` (the run ID) as `.started`; fetch the run for its `session_id` or `error.type`/`error.message`.

### Environment

`environment.created`, `environment.updated` (a no-op update emits nothing), `environment.archived` (re-archiving emits nothing), `environment.deleted`.

### Memory store

`memory_store.created` (by you, **or by an Anthropic-operated process that clones one of your stores**), `memory_store.archived`, `memory_store.deleted` (cascades to memories and versions **without** per-memory events — this single event is the signal).

> **There is deliberately no `memory_store.updated`.** Individual memories and memory versions emit **no webhook events at all**, and neither do an environment's self-hosted work items. For per-memory change tracking, poll the memory-versions endpoints.

> Webhook `data.type` values are a **separate namespace** from SSE event types (`session.status_idled` vs `session.status_idle`; `span.outcome_evaluation_end` vs `session.outcome_evaluation_ended`). Don't reuse SSE constants in webhook handlers.

## Delivery behavior & pitfalls

- **Duplicates.** The same event can arrive more than once; every attempt carries the same top-level `event.id`. Dedupe on it.
- **Subscription scope.** An event reaches only endpoints subscribed to its type **at the moment it is emitted**. Events emitted while nothing was subscribed are never delivered, and subscribing later does **not** backfill.
- **No ordering guarantee.** `session.status_idled` may arrive before `session.outcome_evaluation_ended`; a `.deleted` can arrive before the `.archived` for the same resource. **Drive state from the resource you fetch, not from arrival order.**
- **Retries: up to three attempts** per endpoint per event, jittered exponential backoff between 5 and 120 seconds. **After the last attempt the event is dropped** — not queued, with no signal that it was lost. **Webhooks are not a durable log**: if you must observe every transition, reconcile by listing or fetching the resource.
- **`webhook-timestamp` is re-stamped on every attempt**, so retries don't fail the SDK's five-minute freshness check.
- **Auto-disable — three triggers**, each setting `disabled_reason`, all reversible from Console (**events emitted while disabled are not replayed**):
  - A `3xx` response. Redirects are never followed; disables immediately on the first attempt. `auto-disabled: endpoint URL returned a redirect (3xx)`.
  - The URL resolves to a non-public IP at connect time. Disables immediately. `auto-disabled: endpoint URL resolved to an invalid address`.
  - Continuous failure for a sustained period. `auto-disabled after sustained delivery failures`. **The trigger is duration, not a delivery count** — a single `2xx` resets the window.
- **Thin payload is intentional.** Don't expect `stop_reason`, `outcome_evaluations`, or credential secrets on the body — fetch the resource.

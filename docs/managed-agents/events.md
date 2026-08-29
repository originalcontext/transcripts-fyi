# Events and the SSE stream

Read when consuming session output or steering a running session. For the client-side loop shapes, read [`client-patterns.md`](./client-patterns.md) next.

## Receiving events — three methods

1. **Streaming (SSE):** `GET /v1/sessions/{id}/events/stream` — real-time. **Long-lived**; the server sends periodic heartbeats.
2. **Polling:** `GET /v1/sessions/{id}/events` — paginated event list (`limit` default 1000, `page`). **Returns immediately** — a plain paginated GET, not a long-poll.
3. **Webhooks:** Anthropic POSTs state transitions to your HTTPS endpoint — thin payloads, HMAC-signed. See [`webhooks.md`](./webhooks.md).

Per-thread variants exist for multiagent: `GET /v1/sessions/{sid}/threads/{tid}/events` and `.../threads/{tid}/stream` (note: **not** `/threads/{tid}/events/stream`, which doesn't exist).

> **Don't trust HTTP-library timeouts as wall-clock caps.** `requests` `timeout=(c, r)` and `httpx.Timeout(n)` are **per-chunk** read timeouts that reset on every byte, so a trickling connection can block indefinitely. Neither library has a total wall-clock timeout. Prefer the SDK's `sessions.events.stream()` / `.list()`.

### `processed_at`

All **persisted** events carry `id`, `type`, and `processed_at` (ISO 8601), set when the event finishes processing. On events **you** send, `processed_at` is `null` while queued behind earlier ones — **except** `user.define_outcome`, `user.custom_tool_result`, and `user.tool_result`, which are processed on receipt and echoed back with `processed_at` already populated. The stream-only `event_start` / `event_delta` preview events carry only the `id` of the event they preview.

## Sending events

`POST /v1/sessions/{id}/events`

| Event type | When to send |
|---|---|
| `user.message` | Send a user message |
| `user.interrupt` | Interrupt the agent while it's running |
| `user.tool_confirmation` | Approve/deny a tool call (`always_ask` policy) |
| `user.custom_tool_result` | Provide the result for a custom tool call |
| `user.tool_result` | **Self-hosted environments only** — your integration supplies `agent_toolset` results |
| `user.define_outcome` | Start a rubric-graded iterate loop — see [`outcomes.md`](./outcomes.md) |
| `system.message` | Append privileged system-level context for this turn and every turn after |

Envelope:

```json
{
  "events": [
    { "type": "user.message", "content": [{ "type": "text", "text": "Hello" }] }
  ]
}
```

### `system.message` — mid-session system context

The agent's `system` field is fixed for the session's lifetime. A `system.message` event **appends** to the session's system context as a `role: "system"` turn — it does not replace the prompt. It applies to the accompanying turn and **all subsequent turns**.

```ts
await client.beta.sessions.events.send(session.id, {
  events: [
    { type: "system.message", content: [{ type: "text", text: "The user's current timezone is America/New_York." }] },
  ],
});
```

Constraints:
- **Model-gated.** The bundled copy lists Claude Opus 5, Opus 4.8, Sonnet 5, Fable 5, Mythos 5. [live 2026-08-29] The live reference lists **Opus 4.8, Fable 5, Mythos 5, and Opus 5** (Sonnet 5 omitted); the live platform-availability note also says mid-conversation system messages are "not Claude Sonnet 5". **Treat Sonnet 5 support as uncertain and verify before relying on it.** On an unsupported primary model the event is rejected with `model_does_not_support_mid_conversation_system`.
- Only the agent's **primary** model is checked — `system.message` lands on the primary thread only.
- While `idle` with `stop_reason: requires_action`, a `system.message` is accepted **only when it trails a tool result event in the same request**.
- `content` accepts 1–1000 text items.

## Event type catalog

### Agent events

| Type | Description |
|---|---|
| `agent.message` | Agent response content blocks |
| `agent.thinking` | Progress signal that the agent is thinking — **does not carry thinking content** |
| `agent.tool_use` | Agent invoked a pre-built agent tool |
| `agent.tool_result` | Result of a pre-built agent tool |
| `agent.mcp_tool_use` | Agent invoked an MCP server tool |
| `agent.mcp_tool_result` | Result of an MCP tool |
| `agent.custom_tool_use` | Agent invoked one of your custom tools — respond with `user.custom_tool_result` |
| `agent.thread_context_compacted` | History was compacted to fit the context window (carries `pre_compaction_tokens`) |
| `agent.thread_message_received` | Multiagent: a message arrived on this thread from another |
| `agent.thread_message_sent` | Multiagent: this thread sent a message to another |

Message content in these events can include a `redacted` content block, `{"type": "redacted"}` — a placeholder for content withheld by model policy. It carries no other fields. Redacted blocks appear only in content the platform emits; a **user** event containing one is rejected with 400.

### Session events

| Type | Description |
|---|---|
| `session.status_running` | Agent is actively processing |
| `session.status_idle` | Agent finished its turn and awaits input. Includes `stop_reason`. |
| `session.status_rescheduled` | Transient error; retrying automatically |
| `session.status_terminated` | Session ended — on unrecoverable error **or** because it was archived |
| `session.deleted` | Session deleted. Terminates any active stream; no further events. |
| `session.updated` | An update changed at least one field. Carries **only** the changed fields (a budget removal carries `budget: null`). Updates apply on the next turn. |
| `session.error` | Error during processing. Includes a typed `error` object with a `retry_status`. |
| `session.usage` | Snapshot of cumulative usage and tracked list cost; echoes the session's `budget` (or `null`) |
| `session.thread_created` | A multiagent thread was created (or an advisor consultation started, thread name `anthropic.advisor`) |
| `session.thread_status_running` / `_idle` / `_rescheduled` / `_terminated` | Thread transitions. Every session emits `_running` for its primary thread. `_idle` carries `stop_reason`. |

### Span events (observability markers)

| Type | Description |
|---|---|
| `span.model_request_start` | A model inference call started |
| `span.model_request_end` | Completed. Includes `model_usage` with token counts. |
| `span.outcome_evaluation_start` / `_ongoing` / `_end` | Outcome grader progress — see [`outcomes.md`](./outcomes.md) |

### User events echoed back

The stream echoes user-sent events (`user.message`, `user.interrupt`, `user.tool_confirmation`, `user.tool_result`, `user.custom_tool_result`, `user.define_outcome`) — **except** a `user.interrupt` sent while the session is paused at its budget, which is accepted and ignored and never appears.

### Naming

Persisted event types follow `{domain}.{action}`. The stream-only deltas (`event_start`, `event_delta`) are the one exception. **Webhook `data.type` values are a separate namespace** — for example `session.status_idled` (webhook) vs `session.status_idle` (stream). Don't reuse SSE constants in webhook handlers.

## Useful event payloads

`session.status_idle`:

```json
{
  "id": "sevt_456",
  "processed_at": "2026-04-07T04:27:43.197Z",
  "stop_reason": {
    "event_ids": ["sevt_123"],
    "type": "requires_action"
  },
  "type": "status_idle"
}
```

`span.model_request_end` — the cost-tracking event:

```json
{
  "type": "span.model_request_end",
  "id": "sevt_456",
  "is_error": false,
  "model_request_start_id": "sevt_123",
  "model_usage": {
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 6656,
    "input_tokens": 3571,
    "output_tokens": 727
  },
  "processed_at": "2026-04-07T04:11:32.189Z"
}
```

## Live previews (`event_deltas[]`)

By default assistant text arrives as buffered `agent.message` events, emitted only after the model request finishes. Live previews render text incrementally. The buffered `agent.message` is **always** the authoritative record.

**The wire format is NOT Messages-API streaming** — the delta type is `content_delta`, not `content_block_delta`. Messages-API accumulator code does not carry over unchanged.

**Opt in per stream connection** with the `event_deltas[]` query parameter, repeated per event type. Accepted values: `agent.message`, `agent.thinking`. Any other value → 400; more than 100 values → 400. Both stream endpoints accept it (session-level and per-thread). In a shell, quote the URL or percent-encode brackets as `%5B%5D`.

```ts
const stream = await client.beta.sessions.events.stream(session.id, {
  event_deltas: ["agent.message"],
});
```

Wire shape:

```json
{"type": "event_start", "event": {"type": "agent.message", "id": "sevt_01abc..."}}
{"type": "event_delta", "event_id": "sevt_01abc...", "delta": {"type": "content_delta", "index": 0, "content": {"type": "text", "text": "Here is the summary"}}}
```

**Accumulate-and-reconcile:** treat the preview as a scratch buffer keyed by `(event_id, index)`. On `event_start`, create an empty entry. On each `event_delta`, append `delta.content.text` and render. When the buffered `agent.message` arrives, match by `id`, **discard the preview**, render the message's content. Normal turn order is fixed: `session.status_running` → `span.model_request_start` → `event_start` → `event_delta`* → buffered `agent.message` → `span.model_request_end`. If the turn errors or is interrupted the buffered event may never arrive, but `span.model_request_end` still does — close unreconciled previews there. Python/TypeScript/Go SDKs ship an accumulator helper.

For `agent.thinking`, **only** the `event_start` is emitted — no deltas follow, and the buffered `agent.thinking` carries no thinking content either.

Limitations:
- **Best effort** — under load the server may shed deltas; you receive a contiguous prefix then nothing more for that event. The buffered `agent.message` still arrives complete. **Never treat an accumulated preview as final.**
- **No replay on reconnect.** Deltas go only to the connection that opted in, while it's open. A connection opened after a model request started receives no deltas for that in-flight event.
- **One thread, text only.** Previews are thread-scoped and never cross-posted; a child thread's previews are delivered on that child's stream only.
- **Never persisted** — `event_start` / `event_delta` never appear in `GET /v1/sessions/{id}/events`.

Troubleshooting:

| You see | Meaning |
|---|---|
| Buffered events but no `event_start`/`event_delta` | This connection didn't opt in (`event_deltas[]` is per connection), or the turn ran on a different thread |
| 404 on the stream URL | Wrong path/ID, or no managed-agents beta header (thread endpoints are beta-gated) |
| 400 naming `event_deltas` | Only `agent.message` and `agent.thinking` accepted, max 100 values |

## Steering

### Stream-first ordering

**Open the stream before sending events.** The stream only delivers events occurring *after* it opens — it does not replay current state or history. If you send first and stream second, early events (including fast status transitions) arrive buffered in one batch and you lose real-time reaction.

```ts
// Correct - stream and send concurrently
const [response] = await Promise.all([
  streamEvents(sessionId),   // opens SSE connection
  sendMessage(sessionId, text),
]);

// Wrong - events before stream opens arrive as a single buffered batch
await sendMessage(sessionId, text);
const response = await streamEvents(sessionId);
```

For full history, use `GET /v1/sessions/{id}/events`.

### Reconnecting after a dropped stream

**The SSE stream has no replay.** On every (re)connect, overlap the stream with a history fetch and dedupe by event ID. See [`client-patterns.md` pattern 1](./client-patterns.md#1-lossless-stream-reconnect) for the exact code and the terminal-check gotcha.

**Deadlock risk:** if the stream drops while an `agent.tool_use`, `agent.mcp_tool_use`, or `agent.custom_tool_use` is pending resolution, the session deadlocks (client disconnects → session idles → reconnect happens → no client resolution happens). Always run the consolidation pattern.

### Message queuing

Events can be sent at any time while `running` or `idle`; they queue and process in order. You don't have to wait for a response before sending the next message.

```ts
await sendMessage(sessionId, "Summarize the README");
await sendMessage(sessionId, "Actually also check the CONTRIBUTING guide");
await sendMessage(sessionId, "And compare the two");
```

One exception: a session paused at its budget accepts only settle events — a `user.message` there is a 400.

### Interrupt

```ts
await client.beta.sessions.events.send(sessionId, {
  events: [{ type: 'user.interrupt' }],
});
```

- **Jumps the queue** ahead of pending user messages and forces the session into `idle`.
- The agent stops mid-task. It does **not** see the interrupt as a message — it just halts. Send a follow-up event to explain what to do instead.
- **The interrupted turn ends with `stop_reason: end_turn`** — the same value a naturally-finished turn carries. There is **no** interruption-specific stop reason; track that you sent the interrupt.
- If an outcome is active, the interrupt marks `span.outcome_evaluation_end.result: "interrupted"`.
- Against an already-`idle` session an interrupt is normally a no-op. Exception: a self-hosted session whose worker failed the claimed work item sits `idle` with `stop_reason: requires_action` and no error event; `user.interrupt` re-queues the work.
- **Multiagent: omitting `session_thread_id` interrupts every non-archived thread, including the primary.** Pass `session_thread_id` to stop one. Against a child thread blocked on `requires_action`, the interrupt closes each pending tool call with an *error* tool result (`"Tool execution was interrupted before completion. Please retry."`) and re-emits `session.thread_status_idle` with `stop_reason: end_turn` **directly — the model is not sampled**.
- **Interrupt events may have empty IDs** in the current implementation. Use `processed_at` plus surrounding event IDs when troubleshooting.
- While paused at the budget, the interrupt is **accepted and ignored** and never persisted.

## Reaching a session budget — the event order

A budgeted session pauses rather than overspending. On the stream the pause arrives as three events, in order:

1. `session.thread_status_idle` with `stop_reason: budget_reached`, per thread as it pauses. **A thread whose final request both crosses the cap and finishes its turn reports `stop_reason: end_turn`** while the session still reports `budget_reached` — **key on the session-level `stop_reason`.**
2. `session.usage` — snapshot of cumulative usage and tracked list cost.
3. `session.status_idle` with `stop_reason: budget_reached`. The `session.usage` event **always immediately precedes** this idle.

The session emits a `session.usage` immediately before it goes idle **whatever the stop reason**, so it is a general end-of-turn cost hook, not budget-specific.

`session.usage` carries: cumulative token totals; `list_cost` (`{amount, currency}`, rounded to nearest cent); `active_seconds` (concurrent-thread overlap counted **once**); `server_tool_use` counts (`web_search_requests`, and `web_fetch_requests` which is **always 0** — web fetch is not metered); and an echo of `budget` or `null`. It appears in the events list and the **session** stream; child threads' own streams do **not** carry it. Per-thread `list_cost` figures do **not** sum to the session total (the session figure adds running time and each is rounded independently) — **the session figure is authoritative**.

**To enforce a spend limit, set a budget** rather than polling usage and interrupting yourself — the platform's gate runs before each model request.

## Console session viewer (no-code inspection)

Console sidebar → **Managed Agents** → **Sessions** (Developers and Admins only). Session list with tokens/cost; a **timeline minimap** with one lane per thread; the **transcript** grouped by model request with a Filter events box and copy/download-as-JSON; and an **Inspector** panel (toggle with `d`) with five tabs — Session (details, cumulative-cost chart vs. budget), Events (raw events + Deltas view), Tools (per-tool call counts, failures, median duration), Resources (mounted files, repos, memory changes, `/mnt/session/outputs` files, skills under `/workspace/skills`), Threads (status, context size, cost per thread).

Deep-link with `?event={event_id}` on the session URL — useful in error reports.

## Archiving

```ts
await client.beta.sessions.archive(sessionId);
```

Archiving a **session** is routine cleanup — sessions are per-run and disposable. **Do not generalize to agents or environments**: those are persistent and archiving them is permanent.

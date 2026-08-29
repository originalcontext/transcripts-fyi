# Client patterns

The nine shapes you will actually write. Code is TypeScript, copied from the bundled skill's `shared/managed-agents-client-patterns.md`.

---

## 1. Lossless stream reconnect

**Problem:** SSE has no replay. A naive reconnect re-opens the stream from "now" and silently misses every event in the gap.

**Solution:** on reconnect, open the stream first, then fetch the full event history *before* consuming the live stream, and dedupe on event ID.

```ts
const seenEventIds = new Set<string>()
const stream = await client.beta.sessions.events.stream(session.id)

// Stream is now open and buffering server-side. Read history first.
for await (const event of client.beta.sessions.events.list(session.id)) {
  seenEventIds.add(event.id)
  handle(event)
}

// Tail the live stream. Dedupe only gates handle() - terminal checks must run
// even for already-seen events, or a terminal event that was in the history
// response gets skipped by `continue` and the loop never exits.
for await (const event of stream) {
  if (!seenEventIds.has(event.id)) {
    seenEventIds.add(event.id)
    handle(event)
  }
  if (event.type === 'session.status_terminated') break
  if (event.type === 'session.status_idle' && event.stop_reason.type !== 'requires_action') break
}
```

The commented gotcha is the important part: **do not `continue` on a deduped event before the terminal checks**, or a terminal event that was already in the history response never breaks the loop.

---

## 2. `processed_at` — queued vs processed

Every event carries `processed_at` (ISO 8601), set when it finishes processing. For client-sent events it is `null` while queued and populated once processed — **so the same event appears on the stream twice**, once with `null` and once with a timestamp.

**Three event types skip the queued phase:** `user.define_outcome`, `user.custom_tool_result`, and `user.tool_result` are processed on receipt and echoed back with `processed_at` already populated. A pending→acknowledged UI that assumes "first sighting is always `null`" will never clear for these.

```ts
for await (const event of stream) {
  if (event.type === 'user.message') {
    if (event.processed_at == null) onQueued(event.id)
    else onProcessed(event.id, event.processed_at)
  }
}
```

Mapping a locally-rendered optimistic message to the server-assigned `event.id` is application-specific (typically the return value of `events.send()`, or FIFO ordering).

(Also: a `user.interrupt` sent while paused at the budget never appears at all.)

---

## 3. Interrupt a running session

```ts
await client.beta.sessions.events.send(session.id, {
  events: [{ type: 'user.interrupt' }],
})

// Drain until the session is truly done - see Pattern 5 for the full gate.
for await (const event of stream) {
  if (event.type === 'session.status_terminated') break
  if (
    event.type === 'session.status_idle' &&
    event.stop_reason.type !== 'requires_action'
  ) break
}
```

The session keeps running until it reaches a safe boundary, then goes idle. Reference example in the SDK repo: `interrupt.ts` — sends the interrupt the moment it sees `span.model_request_start`, drains to idle, then verifies via `sessions.retrieve()`.

---

## 4. `tool_confirmation` round-trip

With `permission_policy: { type: 'always_ask' }`, any call to that tool fires an `agent.tool_use` event with `evaluated_permission === 'ask'` and the session goes idle.

```ts
for await (const event of stream) {
  if (event.type === 'agent.tool_use' && event.evaluated_permission === 'ask') {
    await client.beta.sessions.events.send(session.id, {
      events: [{
        type: 'user.tool_confirmation',
        tool_use_id: event.id,         // not a toolu_ id - use event.id
        result: 'allow',               // or 'deny'
        // deny_message: '...',        // optional, only with result: 'deny'
      }],
    })
  }
}
```

- **`tool_use_id` is `event.id`** (typically `sevt_...`), **not** a `toolu_...` ID.
- `result` is `'allow' | 'deny'`. Use `deny_message` to tell the model *why* — it is surfaced back to the agent. (The raw wire example in the tools doc shows the field as `message`; the SDK-facing field shown here is `deny_message`. If one is rejected, try the other.)
- Multiple pending tools: respond once per `agent.tool_use` event with `evaluated_permission === 'ask'`.
- **Multiagent:** subagent asks are cross-posted to the primary thread with `session_thread_id` identifying the originator. Echo that `session_thread_id` back on your confirmation (the server also routes by tool-use ID, so it's belt-and-suspenders — but include it).

Reference example: `tool-permissions.ts`.

---

## 5. Correct idle-break gate

**Do not break on `session.status_idle` alone.** The session goes idle transiently — between parallel tool executions, while waiting for a confirmation, while awaiting a custom tool result.

```ts
for await (const event of stream) {
  handle(event)
  if (event.type === 'session.status_terminated') break
  if (event.type === 'session.status_idle') {
    if (event.stop_reason.type === 'requires_action') continue // waiting on you - handle it
    break // end_turn, retries_exhausted, or budget_reached - see list below
  }
}
```

`stop_reason.type` values on `session.status_idle`:

| Value | Meaning | Action |
|---|---|---|
| `requires_action` | Waiting on a client-side event (tool confirmation, custom tool result) | Handle it, **don't break** |
| `end_turn` | Normal completion — **also what an interrupted turn reports** | Break |
| `retries_exhausted` | Terminal failure | Break, then `sessions.retrieve()` for the error state |
| `budget_reached` | Hit the spend cap and paused. **Not terminal and not resumable by any event** — change or remove `budget` to resume, or treat it as done | Break unless you intend to change the budget |

**Self-hosted exception:** if the session went `requires_action`-idle with **no pending** `agent.tool_use` (always_ask) or `agent.custom_tool_use` to answer, the worker failed the claimed work item (typically a memory-store mount error, logged only on the worker host). Don't `continue` forever — surface it, fix the host, and send `user.interrupt` to re-queue the work.

---

## 6. Post-idle status-write race

The SSE stream emits `session.status_idle` **slightly before** the session's queryable status reflects it. Clients that break on idle and immediately call `sessions.delete()` or `sessions.archive()` intermittently 400 with "cannot delete/archive while running."

```ts
let s
for (let i = 0; i < 10; i++) {
  s = await client.beta.sessions.retrieve(session.id)
  if (s.status !== 'running') break
  await new Promise(r => setTimeout(r, 200))
}
if (s?.status !== 'running') {
  await client.beta.sessions.archive(session.id)
} // else: still running after 2s - don't archive, let it settle or escalate
```

---

## 7. Stream-first, then send

Always open the stream **before** sending the kickoff event, or the agent may process the event and emit its first events before your consumer is attached.

```ts
const stream = await client.beta.sessions.events.stream(session.id)
await client.beta.sessions.events.send(session.id, {
  events: [{ type: 'user.message', content: [{ type: 'text', text: 'Hello' }] }],
})
for await (const event of stream) { /* ... */ }
```

`Promise.all([stream, send])` works too — the stream starts buffering the moment it's opened.

---

## 8. File-mount gotchas

**The mounted resource has a different `file_id` than the file you uploaded.** Session creation makes a session-scoped copy.

```ts
const uploaded = await client.beta.files.upload({ file, purpose: 'agent_resource' })
// uploaded.id         -> the original file
const session = await client.beta.sessions.create({
  /* ... */
  resources: [{ type: 'file', file_id: uploaded.id, mount_path: '/workspace/data.csv' }],
})
// session.resources[0].file_id !== uploaded.id  <- different IDs
```

Delete the original via `files.delete(uploaded.id)`; the session-scoped copy is garbage-collected with the session. `mount_path` must be absolute.

---

## 9. Secrets for non-MCP APIs — keep them host-side

**First check:** for cloud environments the first-class answer is a vault `environment_variable` credential (opaque placeholder in the sandbox, real secret substituted at egress) — see [`tools.md`](./tools.md#vaults--the-credential-store). Use this pattern when that doesn't fit: **self-hosted sandboxes** (env-var credentials not supported there), clients that reject the placeholder via local format validation, secrets that must never leave your infrastructure, or calls needing host-side binaries.

**Solution:** declare a custom tool on the agent; when the agent emits `agent.custom_tool_use`, your orchestrator (the process reading the SSE stream) executes the call with its own credentials and responds with `user.custom_tool_result`. The container never sees the key.

```ts
// Agent template: declare the tool, no credentials
tools: [{ type: 'custom', name: 'linear_graphql', input_schema: { /* query, vars */ } }]

// Orchestrator: handle the call with host-side creds
for await (const event of stream) {
  if (event.type === 'agent.custom_tool_use' && event.name === 'linear_graphql') {
    const result = await linear.request(event.input.query, event.input.vars) // host's key
    await client.beta.sessions.events.send(session.id, {
      events: [{
        type: 'user.custom_tool_result',
        custom_tool_use_id: event.id,
        content: [{ type: 'text', text: JSON.stringify(result) }],
      }],
    })
  }
}
```

**Security note:** this does not expose a public endpoint. `agent.custom_tool_use` arrives on the SSE stream your orchestrator already holds open with your Anthropic API key, and `user.custom_tool_result` goes back via `events.send()` under the same key. Your orchestrator is a client, not a server.

**Do not embed API keys in the system prompt or user messages as a workaround.** They are stored in the session's event history, returned by `events.list()`, and included in compaction summaries — durably persisted and readable via the API for the life of the session.

# Multiagent sessions (the map-reduce surface)

Read when work splits into independent pieces. **This is the mechanism that maps onto "analyze N quarterly transcripts, then synthesize" — see [§ Mapping onto map-reduce](#mapping-onto-map-reduce-over-many-documents).**

A coordinator agent delegates to other agents **within one session**. All agents **share the container and filesystem** and the session's vault credentials; each runs in its own **thread** — a context-isolated event stream with its own conversation history, model, system prompt, tools, MCP servers, and skills (from that agent's own config). Threads are **persistent**: the coordinator can send a follow-up to a subagent it called earlier and that subagent retains its prior turns.

No extra beta header. The SDK sets `managed-agents-2026-04-01` automatically.

---

## When to use it — start with `self`, then add cheaper workers

If the work splits into independent pieces — several sources to research, many files or records to process, anything shaped like *"look into N things, then summarize"* — or one piece would fill its context with reading, **use a multiagent session instead of one long single-threaded loop.** Each delegated piece runs in its own thread with a fresh context window, threads run in parallel in the same container, and **only each subagent's report comes back**, so the coordinator's context stays small.

**There is no orchestration code to write.** The coordinator is given delegation tools automatically (`list_agents`, `send_to_agent`) and decides when to use them; your client still creates one session and reads one stream.

### Step 1 — the smallest useful roster is the agent itself

```python
agent = client.beta.agents.create(
    name="Research assistant",
    description="Researches a question end to end. A copy can be spawned to own one well-scoped sub-question.",
    model="claude-opus-5",
    system="You are a research assistant. When a request splits into independent sub-questions, delegate each to a copy of yourself, one self-contained task per copy, then verify and combine their reports.",
    tools=[{"type": "agent_toolset_20260401"}],
    multiagent={"type": "coordinator", "agents": [{"type": "self"}]},  # the only change vs. a single agent
)

session = client.beta.sessions.create(agent=agent.id, environment_id=env.id)  # unchanged
```

`{"type": "self"}` copies share the coordinator's model, system prompt, and tools, **minus the ability to delegate further**.

### Step 2 — move the reading-heavy work to a cheaper model

Delegated research work is mostly searching, reading, and extracting: many input tokens, little hard reasoning. **A roster entry is only a reference: the worker runs on its own `model`, `system`, and `tools`, and its tokens are billed at its own model's rates.**

```python
worker = client.beta.agents.create(
    name="Web researcher",
    description="Fast, low-cost, read-only researcher. Give it one well-scoped question; it searches, reads, and reports findings with sources.",
    model="claude-haiku-4-5",
    system="Answer exactly the question you are given. Search and read as much as you need, then report concise findings with a source URL or file path for every claim.",
    tools=[{
        "type": "agent_toolset_20260401",
        "default_config": {"enabled": False},
        "configs": [{"name": n, "enabled": True} for n in ("read", "glob", "grep", "web_fetch", "web_search")],
    }],
)

lead = client.beta.agents.create(
    name="Research lead",
    description="Plans and synthesizes research. A copy can be spawned to own one large sub-analysis.",
    model="claude-opus-5",
    system="Plan the work. Delegate each independent, reading-heavy question to Web researcher, one self-contained task per spawn, several in parallel. Keep verification and the final synthesis for yourself; spawn a copy of yourself only for a sub-analysis that needs your full capability.",
    tools=[{"type": "agent_toolset_20260401"}],
    multiagent={"type": "coordinator", "agents": [worker.id, {"type": "self"}]},
)
```

### Step 3 — add dedicated specialists

Give each sub-task type its own agent — own model, narrow `system` prompt, only the tools it needs — and roster them by ID next to `self`. One rostered agent can be spawned **many times** (e.g. three independent reviewers over the same change).

### Design rules

- **Good fits:** parallel research across sources; reading large amounts of material without filling the coordinator's context; specialists with narrow prompts and tool sets. **Poor fit:** a small single-step task — every delegation costs a round-trip and a re-briefing.
- **Write `name` and `description` for the coordinator to read.** The coordinator chooses whom to spawn from each roster entry's name and description. Names must be unique across the roster; **don't name an agent `self`**.
- **Say how to delegate in the coordinator's `system` prompt** — what to hand off and to whom, how many at once, what to keep for itself, and what is too small to delegate. **Subagents see none of the coordinator's conversation**, so each task must carry the paths, constraints, and report format it needs. Spawning returns immediately; the subagent's report arrives in a later coordinator turn.
- **Threads share the container's filesystem, not each other's conversation.** Put the input and output paths in every task.
- **Web tool domain lists layer, never widen.** A roster agent is bound by its own lists, by every caller's, and by the coordinator's current lists (allow-lists intersect, block-lists union). Keep roster allow-lists **inside** the coordinator's — disjoint lists leave the tool present but every call fails `url_not_allowed`.

### Limits

| Limit | Value |
|---|---|
| Roster entries (`multiagent.agents`) | **1–20 unique agents**, at most one `self`, at most one `advisor` |
| Copies per rostered agent | Unlimited (coordinator can spawn many) |
| Delegation depth | **One level.** Rostering an agent that itself carries a `multiagent.agents` roster **fails the create/update with a validation error** — it is enforced, not silently flattened. |
| Concurrent threads per session | **25.** Archive finished threads if a long session needs more. Advisor threads are **exempt**. |
| Inference geo | Coordinator's pin and every roster member's must all be the same value or all unset, else 400 |
| Budget | **One shared cap across all threads.** No per-thread caps. |

---

## Mapping onto map-reduce over many documents

This project's shape — *fetch N quarterly earnings-call transcripts → analyze each (map) → synthesize a cross-quarter explainer (reduce) → open-ended depth loop that re-reads specific quarters* — is the canonical multiagent fit. The live docs name the pattern explicitly:

> **Parallelization:** Fan out independent subtasks simultaneously (searching multiple sources, analyzing separate files) and have the coordinator synthesize the results.

And the bundled docs give a near-identical worked example:

> "The same shape fits a pipeline of different specialists: a fast document extractor (for example on Claude Haiku 4.5) that writes one JSON file per input document, a verifier that checks each file against its source, and a lead that applies the corrections and writes the final table to `/mnt/session/outputs/`. **Put the input and output paths in every task: threads share the container's filesystem, not each other's conversation.**"

Concretely, the mapping is:

| Your stage | Managed Agents mechanism |
|---|---|
| **Map** — one analysis per transcript | Coordinator spawns one thread per quarter against a cheap read-heavy worker agent. Each task message carries the transcript's **mount path** and the **output path** it must write. |
| **Intermediate results** | Files on the shared container filesystem (e.g. one JSON per quarter). **Not** returned through the coordinator's context — only the worker's short report is. |
| **Reduce** — cross-quarter synthesis | The coordinator reads the per-quarter JSON files itself and writes the explainer to `/mnt/session/outputs/`. |
| **Depth loop** — re-read a specific quarter | Threads are **persistent**: the coordinator can `send_to_agent` a follow-up to the thread that already read Q3 and it retains its prior turns — no re-reading cost. |
| **Getting results out** | `client.beta.files.list({ scope_id: session.id, betas: ["managed-agents-2026-04-01"] })` — see [`environments.md`](./environments.md#session-outputs-agent--host) |

Constraints this imposes on the design:
- **25 concurrent threads** caps a single wave of parallelism. For N > 25 quarters, either batch the fan-out or archive finished threads (`sessions.threads.archive`, requires the thread to be idle — `requires_action` counts as idle).
- **20 unique roster agents**, but you only need ~2–3 distinct agents (extractor, verifier, lead); the fan-out comes from spawning many copies of one.
- The coordinator **decides** the fan-out — you don't program it. Steering happens via the `system` prompt and the initial task, not via orchestration code. If you need deterministic fan-out, run separate sessions instead and orchestrate them yourself.

---

## Declare the roster on the coordinator

`multiagent` is a **top-level field** on `agents.create()` / `agents.update()` — **not** a `tools[]` entry, and **not** on `sessions.create()`.

```ts
const coordinator = await client.beta.agents.create({
  name: "Engineering Lead",
  model: "claude-opus-5",
  system:
    "You coordinate engineering work. Delegate code review to the reviewer agent and test writing to the test agent.",
  tools: [{ type: "agent_toolset_20260401" }],
  multiagent: {
    type: "coordinator",
    agents: [
      { type: "agent", id: reviewerAgent.id },
      { type: "agent", id: testWriterAgent.id },
    ],
  },
});
```

| Roster entry | Shape | Notes |
|---|---|---|
| String shorthand | `"agent_abc123"` | Latest version of a stored agent |
| Agent reference | `{type: "agent", id, version?}` | Omit `version` to pin the latest at coordinator save time |
| Self | `{type: "self"}` | Coordinator can spawn copies of itself |
| Advisor | `{type: "advisor", model}` | A model the **primary thread** can consult mid-turn. At most one per roster. |

If the session was created with `agent_with_overrides`, those overrides apply to the **coordinator and its `self` copies**. Roster agents referenced by ID always use their own as-created configuration.

---

## Threads

The session-level event stream **is** the primary thread — the coordinator's trace plus a condensed view of subagent activity (thread status transitions and cross-thread messages, **not** every subagent tool call).

| Operation | HTTP | SDK (`client.beta.sessions.threads.*`) |
|---|---|---|
| List threads | `GET /v1/sessions/{sid}/threads` | `.list(session_id)` |
| Retrieve one | `GET /v1/sessions/{sid}/threads/{tid}` | `.retrieve(thread_id, session_id=...)` |
| Archive | `POST /v1/sessions/{sid}/threads/{tid}/archive` | `.archive(thread_id, session_id=...)` |
| List thread events | `GET /v1/sessions/{sid}/threads/{tid}/events` | `.events.list(thread_id, session_id=...)` |
| Stream thread events | `GET /v1/sessions/{sid}/threads/{tid}/stream` | `.events.stream(thread_id, session_id=...)` |

Each `SessionThread` carries `id`, `status` (`running` \| `idle` \| `rescheduling` \| `terminated`), `agent` (resolved snapshot: `id`, `name`, `model`, `system`, `tools`, `skills`, `mcp_servers`, `version` — except advisor threads, whose `agent` is `{"type": "advisor", "model": ...}`), `parent_thread_id` (null for the primary, which **is** included in the list), `archived_at`, and optional `stats`/`usage`.

- **Session status aggregates thread statuses** — if any thread is `running`, `session.status` is `running`.
- Per-thread `usage.list_cost` does **not** sum to the session total; the session figure is authoritative.
- When draining a per-thread stream, break on `session.thread_status_idle` and check its `stop_reason` as you would the session-level idle.

---

## Multiagent events (on the session stream)

| Event | Payload highlights | Meaning |
|---|---|---|
| `session.thread_created` | `session_thread_id`, `agent_name` | New thread created |
| `session.thread_status_running` | `session_thread_id`, `agent_name` | Thread started |
| `session.thread_status_idle` | `session_thread_id`, `agent_name`, **`stop_reason`** | Thread awaiting input, or paused at the shared budget |
| `session.thread_status_rescheduled` | `session_thread_id`, `agent_name` | Rescheduling after a retryable error |
| `session.thread_status_terminated` | `session_thread_id`, `agent_name` | Thread ended — self-terminated, archived, or terminal error |
| `agent.thread_message_sent` | `to_session_thread_id`, `to_agent_name`, `content` | *This* thread sent a message to another |
| `agent.thread_message_received` | `from_session_thread_id`, `from_agent_name`, `content` | A message arrived on *this* thread |

> **Direction is relative to the thread whose stream carries the event**, not to the coordinator. The same delegated task is `agent.thread_message_sent` on the primary stream and `agent.thread_message_received` on the child's own stream. Reading `_received` as "a subagent finished" is wrong once you're reading a child stream.

---

## Previewing a subagent's text

Each thread's stream accepts the same `event_deltas[]` parameter:

```
GET /v1/sessions/{sid}/threads/{tid}/stream?event_deltas%5B%5D=agent.message
```

**Previews are thread-scoped** — a child's previews are never cross-posted to the session-level stream.

> **Only plain assistant text previews.** A subagent's *reply to its coordinator* rides `agent.thread_message_sent` and is **never previewed**. A worker that does nothing but report back streams no deltas at all, even with a correct opt-in on the right thread. To get a live preview out of a subagent, its prompt has to make it write the answer as a plain assistant message in its own thread first, and only then report to the coordinator.

---

## Advisor

`{"type": "advisor", "model": "<model id>"}` gives the session's **primary thread** an advisor: a model it can consult mid-turn for planning, getting unstuck, or reviewing work. Exactly two fields.

```python
agent = client.beta.agents.create(
    name="Backend engineer",
    model="claude-sonnet-5",
    system="You implement backend features end to end.",
    multiagent={
        "type": "coordinator",
        "agents": [{"type": "advisor", "model": "claude-opus-5"}],
    },
)
```

Rules:
- **At most one advisor per roster.** It occupies the reserved roster name `anthropic.advisor`; a roster also listing a member literally named `anthropic.advisor` is a 400. In responses the advisor entry is echoed **last**.
- **Pairing is validated at agent save:** the advisor model must meet a minimum capability bar, and the agent's own model must not be *more* capable than its advisor (equals can pair). Invalid pairing → 400.
- **Only the primary thread consults it.** Invisible to `list_agents`, unreachable via `send_to_agent`, and roster agents cannot consult it.
- **Plaintext vs redacted delivery.** Claude Opus 5 is the default advisor choice and is a **redacted** advisor — the agent reads the advice server-side, but the client sees `[{"type": "redacted"}]`. Client-readable advice requires a plaintext advisor such as `claude-opus-4-8`, which is only valid when the agent's own model is `claude-opus-4-8` or below. **Agents on Opus 5 / Fable 5 / Mythos 5 cannot get client-readable advice.**
- Consultations run as a platform-spawned thread named `anthropic.advisor` that terminates itself; the advice arrives on the primary thread as `agent.thread_message_received`. **No `agent.tool_use` and no `agent.thread_message_sent`** are emitted, and **the advice delivery is not guaranteed to precede the advisor thread's idle/terminated events.**
- A failed or interrupted consultation never fails the agent's turn — the agent continues after a generic notice.
- **Exempt from the 25-thread limit.** Billed at the advisor model's rates; counts against the session budget. Advisor-side prompt caching is automatic.
- **Removing:** update the agent with a roster omitting the entry; if it was the only entry, clear with `"multiagent": null`.

---

## Tool permissions and custom tools from subagent threads

When a subagent needs your client (an `always_ask` confirmation, or a custom tool result), the request is **cross-posted to the primary thread** with `session_thread_id` identifying the originating thread — so you only need to watch the session stream. Reply with `user.tool_confirmation` (`tool_use_id`) or `user.custom_tool_result` (`custom_tool_use_id`), and **echo the `session_thread_id`**.

```python
for event_id in stop.event_ids:
    pending = events_by_id[event_id]
    confirmation = {
        "type": "user.tool_confirmation",
        "tool_use_id": event_id,
        "result": "allow",
    }
    if pending.session_thread_id is not None:
        confirmation["session_thread_id"] = pending.session_thread_id
    client.beta.sessions.events.send(session.id, events=[confirmation])
```

---

## Interrupting and archiving threads

- **`user.interrupt` without `session_thread_id` interrupts every non-archived thread, including the primary.** Pass `session_thread_id` to target one.
- Against a child thread blocked on `requires_action`, the interrupt closes each pending tool call with an *error* result (`"Tool execution was interrupted before completion. Please retry."`) and re-emits `session.thread_status_idle` with `stop_reason: end_turn` **directly — the model is not sampled**.
- **Archive requires the thread to be idle, and `requires_action` counts as idle.** Only a *running* thread must be interrupted first. Archiving frees a slot against the 25-thread limit.

## Pitfalls

- **Don't put the roster on `sessions.create()` or in `tools[]`.** `multiagent` is a top-level agent field.
- **Don't assume shared context.** Threads share the filesystem but not conversation history or tools.
- **Depth > 1 is a validation error.**

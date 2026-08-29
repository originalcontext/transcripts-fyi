# Core: agents, sessions, versioning, budgets

Read when you need object shapes, lifecycle rules, `stop_reason` values, or spend caps.

## Architecture

| Concept | Endpoint | What it is |
|---|---|---|
| **Agent** | `/v1/agents` | Persisted, versioned config: model, system prompt, tools, MCP servers, skills. **Must exist before a session.** |
| **Session** | `/v1/sessions` | A stateful run against an agent, in an environment. Produces an event stream. |
| **Environment** | `/v1/environments` | Reusable template for container provisioning. |
| **Container** | n/a | Isolated compute where the agent's **tools** execute. The agent loop does **not** run here — it runs on Anthropic's orchestration layer and acts on the container via tool calls. |

```
                       +-------------------------------------+
                       |  Anthropic orchestration layer      |
Agent (config) ------->|  (agent loop: Claude + tool calls)  |
                       +--------------+----------------------+
                                      | tool calls
                                      v
Environment (template) --> Container (tool execution workspace)
                                 |
                         Session -+
                                 +-- Resources (files, repos, memory stores - attached at startup)
                                 +-- Vault IDs (MCP credential references)
                                 +-- Conversation (event stream in/out)
```

---

## Agents

### Agent object (all top-level — the API is flat)

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | Yes | 1–256 chars |
| `model` | string or object | Yes | Bare id, or `{id, speed?, effort?, inference_geo?}`. All Claude 4.5+ models supported. |
| `system` | string | No | Up to 100,000 chars |
| `tools` | array | No | Agent toolset / MCP toolset / custom tools. **Max 128.** |
| `mcp_servers` | array | No | **Max 20**, unique names |
| `skills` | array | No | **Max 20** |
| `description` | string | No | Up to 2048 chars |
| `multiagent` | object | No | `{type: "coordinator", agents: [...]}` — see [`multiagent.md`](./multiagent.md) |
| `metadata` | object | No | Max 16 pairs, keys ≤64 chars, values ≤512 chars |

### Lifecycle: create once, run many, update in place

```
+- setup (once) ---------+     +- runtime (every invocation) -+
| agents.create()        |     | sessions.create(             |
|   -> store agent_id    | ---> |   agent={type:..., id: ID}   |
|     in config/env/db   |     | )                            |
+------------------------+     +------------------------------+
```

**Anti-pattern:** `agents.create()` at the top of a per-request or per-cron-tick function. Hoist it to setup and persist the ID. The recommended production shape is version-controlled YAML applied with `ant beta:agents create < agent.yaml` (see [`api-reference.md`](./api-reference.md#ant-cli-control-plane)).

### Versioning

Each `POST /v1/agents/{id}` creates a new immutable version — sequential integer starting at 1. History is append-only.

`version` on update is **optional**:

| `version` | Behavior | Fits |
|---|---|---|
| Supplied (≥ 1) | 409 if it doesn't match current version — **even when the fields you send already equal the stored values**. Re-read and retry. | Interactive callers; recommended default |
| Omitted | Applies unconditionally; last write wins silently. | Declarative CI apply loops |

**Update semantics.** Omitted fields are preserved. Scalars (`model`, `system`, `name`, `description`) are replaced; `system` and `description` can be cleared with `null`, `model` and `name` cannot. Array fields (`tools`, `mcp_servers`, `skills`) are replaced wholesale — `null` or `[]` clears them. **`effort` is the sole exception inside a supplied `model` object:** if `id` is unchanged, omitting `effort` leaves the stored level alone; if you change `id`, an omitted `effort` resets to the new model's default. Supplying `model` without `inference_geo` **clears** the pin.

Why version: reproducibility (pin `{type: "agent", id, version: 3}`), safe iteration (running sessions keep their pinned version), rollback.

### Effort

Pass `model` as an object: `{"id": "claude-opus-5", "effort": "high"}`. `effort` accepts a level string (`low`, `medium`, `high`, `xhigh`, `max`) or an object like `{"type": "high"}`.

> **Effort is agent configuration only.** An `effort` set inside a per-session `model` override is **not applied**. [live 2026-08-29] Because the override replaces the `model` object in full, the agent's own `effort` is **not carried over either** — a session created with a `model` override runs at the model's **default** effort level. (The bundled copy said it runs "at the agent's effort"; the live docs are the corrected statement.) To run at a specific effort, set it on the agent and don't override `model` for that session.

Same object form carries `speed` for fast mode: `{"id": "claude-opus-5", "speed": "fast"}` (Opus 5 / Opus 4.8, first-party API only).

### Inference geography (`inference_geo`)

`{"id": "claude-opus-5", "inference_geo": "us"}`. Accepts `"us"` or `"global"`. Unlike the Messages API it is **always nested inside `model`**, never top-level.

- Validated against the workspace's `allowed_inference_geos` at agent save, session create, and **every turn served**. If the allowlist narrows, new sessions can't be created and **running sessions refuse further turns** — pins are never grandfathered.
- Fixed for a session's lifetime.
- Multiagent rosters must be geo-uniform (all same value or all unset), else 400.
- Unlike `effort`, an `inference_geo` inside a per-session `model` override **is** applied — and an override omitting it clears the pin for that session.

### Agent endpoints

| Operation | Method | Path |
|---|---|---|
| Create | `POST` | `/v1/agents` |
| List | `GET` | `/v1/agents` |
| Get | `GET` | `/v1/agents/{id}` |
| Update | `POST` | `/v1/agents/{id}` |
| Archive | `POST` | `/v1/agents/{id}/archive` |
| List versions | `GET` | `/v1/agents/{id}/versions` |

> **Archive is permanent.** Existing sessions continue; **new sessions cannot reference it**; there is no unarchive. Agents have no `delete`, so archive is the terminal state. Never archive a production agent as routine cleanup — confirm with the user first.

---

## Sessions

### Session lifecycle

```
rescheduling -> running <-> idle -> terminated
```

| Status | Meaning |
|---|---|
| `idle` | Agent finished the current task and awaits input. Either waiting on a `user.message`, blocked awaiting `user.custom_tool_result` / `user.tool_confirmation`, or paused at the budget cap. `stop_reason` says which. |
| `running` | Agent is actively working. |
| `rescheduling` | Retrying after a retryable error. |
| `terminated` | Irreversible and unusable — **either on completion or on unrecoverable error**. Terminated ≠ failure; fetch the session to tell them apart. |

- Events can be sent while `running` or `idle`; they queue and process in order. Exception: a session paused at its budget accepts only settle events.
- Errors surface as `session.error` **events**, not as a status value.
- Console trace view: `https://platform.claude.com/workspaces/{workspace}/sessions/{session_id}`. `{workspace}` is the workspace the API key belongs to — `default` only if that's the org's Default workspace. The session response does **not** include a workspace field.

### Built-in session features

- **Context compaction** — history is automatically condensed near the context limit (emits `agent.thread_context_compacted`).
- **Prompt caching** — repeated historical tokens are cached automatically.
- **Extended thinking** — on by default; `agent.thinking` events signal progress and carry **no** thinking content.

### Session object fields

| Field | Notes |
|---|---|
| `type` | always `"session"` |
| `id` | `sesn_...` |
| `title`, `metadata` | metadata max 8 keys |
| `status` | `idle` \| `running` \| `rescheduling` \| `terminated` |
| `created_at`, `updated_at`, `archived_at` | ISO 8601 |
| `environment_id` | |
| `agent` | resolved agent configuration (post-override); `id`/`version` still identify the base agent |
| `resources` | attached files, repos, memory stores |
| `usage` | token counts, `server_tool_use` (web search/fetch request counts), `list_cost` (`{amount, currency}`, integer string in **cents**), `active_seconds` (concurrent-thread overlap counted **once**) |
| `budget` | the spend cap, if one was set at creation |
| `stats` | timing; `stats.active_seconds` **sums per-thread time**, unlike `usage.active_seconds` |

The session object has **no `stop_reason` field** — read the latest `session.status_idle` event for that.

### Creating a session

| Field | Required | Notes |
|---|---|---|
| `agent` | **Yes** | string \| `{type:"agent",id,version}` \| `{type:"agent_with_overrides",...}` |
| `environment_id` | **Yes** | |
| `title` | No | |
| `resources` | No | files, GitHub repos, memory stores — attached at startup. Memory stores are **session-create-only**. |
| `initial_events` | No | Max 50; starts the loop in the same call. |
| `vault_ids` | No | `vlt_*`. **Create-only** — rejected on update. |
| `budget` | No | `{type:"limit", max_list_cost:{amount, currency}}`. **Create-only.** |
| `metadata` | No | |

### `initial_events`

A **non-empty** `initial_events` array starts the agent loop in the same call — the session is created directly in `running`, never passing through `idle`. A client waiting for an `idle → running` transition will wait forever; check `status` on the create response.

- **Only `user.message` and `user.define_outcome` accepted**, max **50**. Tool-result kinds are rejected (no agent turn exists yet); `user.interrupt` is rejected (no turn to stop). Unlike a deployment's `initial_events`, a session's does **not** accept `system.message`.
- Events are validated and persisted before the create response returns, in list order, with server-assigned IDs.
- **They are not echoed on the create response.** Read them back with `sessions.events.list(session.id)`.
- **Validation is all-or-nothing.** Empty list ≡ omitting the field.
- Rejections: >1 `user.define_outcome` → 400; `user.define_outcome` without `rubric` → 400; >100 file-sourced `document` content blocks across the list → 400; body over 32 MB → 413.

[live 2026-08-29] On sandbox provisioning the live docs say: *"Creating a session without `initial_events` registers the session but does not start any work; the environment's sandbox begins provisioning as soon as the session is created, so the first tool call does not wait on it."* (The bundled copy said the sandbox comes up lazily "when the session first needs it".)

### Session operations

| Operation | Notes |
|---|---|
| List / fetch | Paginated list or single by ID |
| Update | `title`, `metadata`, session-local `agent.tools`/`agent.mcp_servers`; `budget` can only be **changed or removed**. `vault_ids` is create-only — update requests setting it are rejected. |
| Archive | Session becomes **read-only**. Not reversible. Routine cleanup for sessions (unlike agents/environments). |
| Delete | Permanently deletes session, event history, container, and checkpoints. |

---

## Session budgets

An optional **hard spend ceiling** set at session creation. The platform prices everything the session consumes at **public list rates** (the session's *list cost*) and stops issuing new model requests once that total reaches the cap. A session at its budget **pauses and goes `idle` with `stop_reason: budget_reached`** — it is not terminated; history and sandbox are preserved.

```ts
const session = await client.beta.sessions.create({
  agent: AGENT_ID,
  environment_id: ENVIRONMENT_ID,
  budget: {
    type: "limit",
    max_list_cost: { amount: "2500", currency: "USD" },  // minor units: "2500" = $25.00
  },
});
```

- `type` is always `"limit"`. `max_list_cost.amount` is **minor units (US cents) as an integer string**, no leading zeros, > 0. `"2500"` = $25.00, `"50"` = 50 cents. Decimal forms like `"25.00"` are **rejected**. `currency` is uppercase ISO-4217; **`USD` is the only supported currency**.
- **What counts toward list cost:** model tokens at each served model's list price; **web searches at $10 per 1,000**; **session running time at $0.08/hour**. List cost is *not* your contracted price — negotiated discounts mean billed spend may be lower than the cap.
- **Enforcement is a pre-request gate.** The check runs before each model request; the request that crosses the cap completes. Final figure can exceed the cap **by at most one model request per running thread**. Treat the budget as a bound on new work, not an exact stop.
- Reported `list_cost` is **rounded to the nearest cent** while enforcement compares exact amounts. Key on `stop_reason: budget_reached` (or the 400 on `user.message`), not the reported figure.
- **Create-only.** Adding a budget to a session created without one is a 400. Updates accept exactly two changes: **change the cap** (higher or lower, but must be *strictly greater* than the consumed list cost, else 400 `budget.max_list_cost must be greater than the session's consumed list cost`), or **remove** (`budget: null`). Base a new value on `usage.list_cost`, not the old cap, and set it a cent or more above (the reported value is rounded).
- **Removal is one-way** — a removed budget can never be re-added.
- **At the cap, only settle events are accepted**: `user.tool_confirmation`, `user.tool_result`, `user.custom_tool_result`, `user.interrupt`. Anything that starts new work (e.g. `user.message`) is a 400 naming that list. A `user.interrupt` sent while paused at the budget is **accepted and ignored** — it does not appear in the event list and changes nothing. **No event resumes the session** — only a budget change/removal does.
- **Multiagent:** one budget shared across all threads, no per-thread caps. Threads pause independently, each priced at its own served model. Advisor consultations count against the same budget. A pending tool ask **outranks** the cap: one thread at `requires_action` + one at `budget_reached` reports `requires_action` at session level.
- **Models without a list price can't be budgeted.** A budgeted create whose agent (or any roster agent, including the advisor's model) uses an unpriced model is a 400. If a running budgeted session's usage comes to include one, changing the budget is rejected — remove it to resume.
- Deployments carry the same `budget` object, with different update semantics — see [`scheduled-deployments.md`](./scheduled-deployments.md).

> **Not the same as Messages-API task budgets.** Session budgets are hard, dollar-denominated, platform-enforced caps on one session. `task_budget` on the Messages API is an advisory, token-denominated budget the model uses to pace itself within one agentic loop.

Budget error reference:

| Condition | Status |
|---|---|
| A work-starting event sent while at/over budget | 400 |
| Budget set at or below the consumed list cost | 400 |
| Budget added to a session created without one, or re-added after removal | 400 |
| `amount` not a whole number of cents, zero/negative, or `currency` ≠ `USD` | 400 |
| Budgeted create references a model with no public list price | 400 |

---

## Override agent configuration for a session

`agent_with_overrides` replaces parts of the agent config for **one session** without versioning the agent.

```ts
const session = await client.beta.sessions.create({
  agent: {
    type: "agent_with_overrides",
    id: agent.id,
    model: { id: "claude-sonnet-5" },   // replace the agent's model for this session
    system: null,                        // clear the system prompt for this session
  },
  environment_id: environmentId,
});
```

Tri-state rules per overridable field (`model`, `system`, `tools`, `mcp_servers`, `skills`):

- **Omit** → inherit from the referenced agent version.
- **`null`** (or `[]` for list fields) → field cleared. Applies in full to `system` and `skills`. Three exceptions:
  - `model` is never clearable (`model: null` → 400 `agent_model_required`).
  - Clearing `tools` → 400 when effective `skills` is non-empty (skills require the `read` tool).
  - Clearing `mcp_servers` → 400 when effective `tools` still contains an `mcp_toolset` referencing one of the agent's servers. Override `tools` in the same request first.
- **A value** → replaces the agent's value **in full**. Overrides never merge — a `tools` override must list every tool the session should have.

Overrides are session-local: they do not modify the agent resource or create a version. The response's `agent` reflects the post-override config while `id`/`version` still identify the base agent. In multiagent sessions, overrides apply to the **coordinator and its `{"type":"self"}` copies only**; roster agents referenced by ID use their own as-created config.

## Updating agent configuration mid-session

`sessions.update()` can change **`agent.tools` and `agent.mcp_servers` only** on an existing session (including permission policies and the per-tool web settings). This is a **session-local override** — it does not create an agent version.

- Arrays are **full replacements**. To append one tool: `GET` the session, modify, `POST` back.
- **The session must be `idle`** — interrupt first if running.
- `vault_ids` is create-only (the SDK param exists but the API rejects it: "Not yet supported").
- `model`, `system`, and `skills` are fixed for the session's lifetime — use `agent_with_overrides` at create time instead.
- You can still append system-level context between turns with a `system.message` event — see [`events.md`](./events.md#systemmessage-mid-session-system-context).

```ts
await client.beta.sessions.update(session.id, {
  agent: {
    tools: [
      { type: "agent_toolset_20260401" },
      { type: "mcp_toolset", mcp_server_name: "linear" },
    ],
    mcp_servers: [{ type: "url", name: "linear", url: "https://mcp.linear.app/sse" }],
  },
});
```

## Interrupts and termination

Full interrupt semantics live in [`events.md`](./events.md#interrupt). Short version:

- `user.interrupt` **jumps the queue** ahead of pending user messages and forces the session to `idle`. The agent does not see it as a message — it just halts.
- **The interrupted turn ends with `stop_reason: end_turn`** — same value as a turn that finishes on its own. There is no interruption-specific stop reason; track that you sent the interrupt.
- Against an already-`idle` session an interrupt is normally a no-op.
- In a multiagent session, **omitting `session_thread_id` interrupts every non-archived thread including the primary**. Pass `session_thread_id` to target one.
- Interrupt events may have empty IDs in the current implementation.
- Terminate = `terminated` status, reached on completion or unrecoverable error, or by archiving. Not reversible.
